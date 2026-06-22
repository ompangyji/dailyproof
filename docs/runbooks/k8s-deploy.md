# Kubernetes 배포 (Helm)

web·worker를 표준 Kubernetes 매니페스트(Helm 차트)로 정의하고, 환경(staging/prod)별 차이를 values로 분리한다. 차트는 순수 k8s API 객체라 **로컬 k3s에서 EKS 등 어떤 conformant 클러스터로도 그대로 이식** 가능하다(로컬 검증은 k3s).

기준: `deploy/helm/dailyproof/`.

---

## 1. 차트 구조

```
deploy/helm/dailyproof/
  Chart.yaml
  values.yaml                 # base(dev 기준 기본값)
  values-staging.yaml         # staging override
  values-prod.yaml            # prod override
  values-secret.example.yaml  # 시크릿 주입 예시(실값 사본은 values-secret.yaml = gitignored)
  templates/
    _helpers.tpl              # 이름·라벨
    web-deployment.yaml       # web Deployment (+ liveness/readiness probe)
    web-service.yaml          # web Service (ClusterIP)
    worker-deployment.yaml    # worker Deployment
    configmap.yaml            # 비밀 아닌 설정
    secret.yaml               # 시크릿(빈 placeholder, 실값은 주입)
    networkpolicy.yaml        # default-deny + 필요한 흐름만 (networkPolicy.enabled, 기본 true)
    web-hpa.yaml              # web CPU 오토스케일 HPA (autoscaling.web.enabled, 기본 false)
    worker-scaledobject.yaml  # worker pending 큐 깊이 스케일 KEDA ScaledObject (autoscaling.worker.enabled, 기본 false)
    jaeger.yaml               # 트레이스 수집 jaeger all-in-one (jaeger.enabled, 기본 true)
    monitoring.yaml           # ServiceMonitor + 보안 알림 PrometheusRule (monitoring.enabled, 기본 false)
    postsync-smoke-job.yaml   # ArgoCD PostSync hook smoke (postSyncSmoke.enabled, 기본 true)
```

| 리소스 | 설명 |
|--------|------|
| web Deployment | liveness=`/health/live`, readiness=`/health/ready`, 비루트, resource limit |
| web Service | ClusterIP, 포트 3000 |
| worker Deployment | 큐 소비 프로세스(HTTP 미개방 → httpGet probe 없음) |
| ConfigMap | `APP_ENV`·`LOG_LEVEL`·`OTEL_*`·`WORKER_*`·공개 `NEXT_PUBLIC_*` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY`(worker만 참조) |
| NetworkPolicy | default-deny + allow-dns + web-ingress + app-egress (`networkPolicy.enabled`, 기본 on) |
| web HPA | CPU 기준 HorizontalPodAutoscaler (`autoscaling.web.enabled`, 기본 off — metrics-server 필요) |
| worker ScaledObject | pending 큐 깊이 기준 KEDA 스케일 (`autoscaling.worker.enabled`, 기본 off — KEDA 필요) |
| jaeger | all-in-one Deployment+Service, OTLP `http://jaeger:4318` 수신, 저장 in-memory (`jaeger.enabled`, 기본 on) |
| ServiceMonitor + PrometheusRule | web `/metrics` scrape + 보안 알림 3개 (`monitoring.enabled`, 기본 off — kube-prometheus-stack CRD 필요) |
| PostSync smoke Job | ArgoCD PostSync hook, `/health`·`/metrics` 검증 (`postSyncSmoke.enabled`, 기본 on) |

> 보안/확장/관측 매니페스트는 토글로 분리돼 있다(CRD·외부 컴포넌트 의존이 있는 것은 기본 off). 동작 원리·전제·한계는 각 전문 문서로 링크아웃한다(§6).

---

## 2. 환경별 설정 (values 분리)

base `values.yaml`에 환경 override를 덮어쓴다. 차이만 담는다.

| | staging | prod |
|---|---------|------|
| `APP_ENV` | staging | prod |
| `LOG_LEVEL` | info | warn |
| web replicas | 1 | 2 |
| worker replicas | 1 | 2 |
| image tag | staging | prod |
| prod resources | (base) | web/worker 상향 |

```bash
helm template dp deploy/helm/dailyproof -f deploy/helm/dailyproof/values-staging.yaml
helm template dp deploy/helm/dailyproof -f deploy/helm/dailyproof/values-prod.yaml
```

---

## 3. 시크릿 주입

차트에는 시크릿 실값이 없다(빈 placeholder). 실값은 차트 밖에서 주입한다:

- 로컬/수동: `values-secret.yaml`(gitignored) 작성 후 `-f`로 추가, 또는 `--set secrets.SUPABASE_SERVICE_ROLE_KEY=…`
- Terraform: tfvars → helm_release values (다음 단계)

`values-secret.example.yaml`이 주입 형태를 보여준다. web은 service_role을 쓰지 않아 Secret을 참조조차 안 한다(최소 권한).

---

## 4. 렌더·검증·적용

```bash
helm lint deploy/helm/dailyproof
helm template dp deploy/helm/dailyproof -f <env values>           # 렌더 확인
helm template ... | kubectl apply --dry-run=server -f -           # 실 API 스키마 검증
```

실제 적용(로컬 k3s)은 이미지를 **k3s containerd로 import**해야 파드가 뜬다(레지스트리 미사용):

```bash
docker save dailyproof-web:latest | sudo k3s ctr images import -
docker save dailyproof-worker:latest | sudo k3s ctr images import -
```

차트를 클러스터에 올리는 것은 Terraform(helm provider)으로 한다(다음 단계) — `helm install` 직접 대신 IaC로 관리.

---

## 5. Terraform으로 실제 배포 (IaC)

`helm install`을 직접 치는 대신 **Terraform(helm provider)** 이 릴리스를 선언적으로 관리한다(`deploy/terraform/`).

```bash
# 1) 이미지를 k3s containerd로 import (레지스트리 미사용). values 태그에 맞춰 태그를 단다.
for c in web worker; do
  docker tag dailyproof-$c:latest dailyproof-$c:staging
  docker save dailyproof-$c:staging | sudo k3s ctr images import -
done

# 2) 시크릿 주입값 작성(gitignored)
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # 실값 채우기 (environment=staging)

# 3) apply
terraform init && terraform apply

# 4) 확인
kubectl get pods -n dailyproof
```

배포 후엔 `SMOKE_BASE_URL=<앱 주소> npm run smoke`로 검증하고, 실패 시 `runbooks/rollback.md`로 되돌린다.

> **WSL drvfs 주의**: `/mnt/d`(윈도우 마운트)에서 `terraform init`은 provider/lock 파일 `chmod`가 막혀 실패한다(drvfs 제약). **WSL 네이티브 경로에서 실행**한다 — 예: `rsync -a /mnt/d/dev/DailyProof/deploy ~/dailyproof-deploy/ && cd ~/dailyproof-deploy/deploy/terraform`. (`next build`·git chmod와 같은 계열 문제. 리눅스 fs/CI에선 무관.)

`environment=prod`로 하려면 이미지 태그를 `prod`로 달아 import하면 된다(values-prod.yaml이 `tag: prod`).

> ⚠️ web 이미지의 `NEXT_PUBLIC_*`(URL·anon 키)는 **빌드 시점에 번들에 박힌다.** 이 값을 바꾸려면 `docker tag`만으론 안 되고 `docker build --build-arg NEXT_PUBLIC_...`로 **재빌드**한 뒤 import해야 한다(자세한 함정은 `argocd.md` §5 트러블슈팅).

## 6. 보안·확장·관측·admission (상세는 전문 문서로)

위 매니페스트들의 설계 의도·전제·운영은 차트에 인라인 주석으로, 깊은 설명은 전용 문서로 둔다. 여기선 "어디에 있고 무엇을 보면 되는지"만:

- **NetworkPolicy** — default-deny 위에 필요한 흐름(dns·web ingress·app egress)만 연다. 설계·FQDN 한계: `../architecture/network.md`.
- **오토스케일(HPA/KEDA)** — web=CPU HPA, worker=pending 큐 깊이(KEDA). 켜면 해당 Deployment의 정적 replicas는 생략된다. 근거(부하 측정·임계값): `../architecture/scaling.md`.
- **트레이스 수집(jaeger)** — web·worker가 `http://jaeger:4318`(OTLP)로 보낸다. UI(16686)는 인증이 없어 ingress 미노출 → `kubectl port-forward`로 접근: `../architecture/tracing.md`.
- **메트릭(monitoring)** — ServiceMonitor가 web `/metrics`를 scrape, PrometheusRule이 보안 이벤트 알림 3개. kube-prometheus-stack CRD가 필요해 기본 off: `../architecture/metrics.md`.
- **admission control(Kyverno)** — 차트가 아니라 별도 디렉토리 `deploy/kyverno/`에 ClusterPolicy 4개(비루트·RO rootfs·drop-all-caps·disallow-latest, Enforce). helm(`kyverno/kyverno`)으로 설치: `../security/admission-control.md`.
- **시크릿 봉인(sealed-secrets)** — 암호화한 SealedSecret을 `deploy/sealed-secrets/`에 커밋(평문 미커밋). 봉인·복호화 절차: `secret-management.md`.

---

## 7. 후속

- **이미지 레지스트리**: 지금은 로컬 import. CI에서 빌드→레지스트리 push→태그 참조로 전환([추후]).
- **Ingress**: web Service는 ClusterIP. 외부 노출은 Ingress(k3s Traefik) 또는 NodePort로([추후], 배포 단계).
- **worker liveness**: HTTP가 없어 현재 probe 없음 — 폴링 동작을 드러내는 exec/파일 기반 probe로 보강([추후]).

참고: `architecture/environments.md`(환경 분리 전략), `runbooks/local-stack.md`(compose 로컬 스택), `runbooks/runbook.md`(운영 절차).
