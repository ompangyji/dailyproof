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
```

| 리소스 | 설명 |
|--------|------|
| web Deployment | liveness=`/health/live`, readiness=`/health/ready`, 비루트, resource limit |
| web Service | ClusterIP, 포트 3000 |
| worker Deployment | 큐 소비 프로세스(HTTP 미개방 → httpGet probe 없음) |
| ConfigMap | `APP_ENV`·`LOG_LEVEL`·`OTEL_*`·`WORKER_*`·공개 `NEXT_PUBLIC_*` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY`(worker만 참조) |

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

## 5. 후속

- **실제 apply**: Terraform helm_release로 로컬 k3s에 배포(이미지 import 후) — IaC 실증.
- **이미지 레지스트리**: 지금은 로컬 import. CI에서 빌드→레지스트리 push→태그 참조로 전환([추후]).
- **Ingress**: web Service는 ClusterIP. 외부 노출은 Ingress(k3s Traefik) 또는 NodePort로([추후], 배포 단계).
- **worker liveness**: HTTP가 없어 현재 probe 없음 — 폴링 동작을 드러내는 exec/파일 기반 probe로 보강([추후]).

참고: `architecture/environments.md`(환경 분리 전략), `runbooks/local-stack.md`(compose 로컬 스택), `runbooks/runbook.md`(운영 절차).
