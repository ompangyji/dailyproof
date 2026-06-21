# 회고: helm upgrade가 내 이미지를 되돌렸다 — 명령형 vs 선언형 충돌

보안 알림 firing을 보려고 web을 새 이미지(계측 코드 포함)로 바꿨는데, 알림 임계를 조정하려 `helm upgrade`를 한 번 더 돌리자 **이미지가 옛날 걸로 되돌아가** 메트릭이 다시 사라졌다. `kubectl set image`(명령형)와 helm(선언형)이 같은 리소스를 두고 싸운 결과다.

## 상황

목표: `dailyproof_security_events_total` → Prometheus scrape → 알림 firing 데모.

1. 계측 코드가 든 새 이미지를 만들어 적용:
   `kubectl set image deploy/dp-dailyproof-web web=dailyproof-web:sec -n dailyproof`
   → `/metrics`에 보안 카운터 노출됨(20). Prometheus도 수집 확인.
2. 알림 임계를 데모용으로 낮추려고 차트 룰을 수정한 뒤 적용:
   `helm upgrade dp deploy/helm/dailyproof -n dailyproof --reset-then-reuse-values --set monitoring.enabled=true`
3. 그 뒤 트래픽을 줘도 **Prometheus에 보안 메트릭이 사라졌다**(쿼리 결과 빈 값).

## 진단 (어떤 명령으로 좁혔나)

먼저 "Prometheus가 보는 값"을 클러스터 안에서 직접 질의 → 비어 있었다:
```bash
# Prometheus API로 메트릭/알림 직접 조회 (port-forward 없이 일회성 pod)
kubectl run prom-q --rm -i --restart=Never --image=curlimages/curl:8.11.1 -n monitoring --command -- \
  sh -c 'curl -s "http://kps-kube-prometheus-stack-prometheus:9090/api/v1/query?query=dailyproof_security_events_total"'
# → 빈 결과(series 없음)
```
"파이프라인은 아까 됐는데 왜 사라졌지?" → 끝단(web 이미지)을 의심하고 현재 이미지를 확인:
```bash
kubectl get deploy dp-dailyproof-web -n dailyproof -o jsonpath='{.spec.template.spec.containers[0].image}'
# → dailyproof-web:staging   (내가 넣은 :sec 이 아니라 옛 이미지로 돌아가 있음!)
```
→ **`helm upgrade`가 차트 값(`image.web.tag: staging`)대로 이미지를 다시 렌더해 덮어쓴 것.** `kubectl set image`로 바꾼 `:sec`은 helm이 모르는 변경(차트 밖)이라, helm이 "원하는 상태"로 되돌렸다(self-heal 성격).

## 원인 — 명령형 변경은 선언형 도구가 모른다

- **`kubectl set image`(명령형)**: "지금 이 이미지로 바꿔." 클러스터 라이브 상태만 바꾼다.
- **`helm upgrade`(선언형)**: "차트+값이 정의한 상태로 맞춰." 차트 밖에서 손댄 변경은 **인식하지 못하고 덮어쓴다.**

둘을 같은 리소스(web Deployment의 image)에 섞어 쓰면, 나중에 도는 선언형이 명령형 변경을 지운다. ArgoCD의 `selfHeal`도 같은 원리로 드리프트를 되돌린다 — 선언형 세계에선 "git/차트가 진실"이기 때문이다.

## 해결

당장은 이미지를 다시 가리키되, **그 뒤로 `helm upgrade`를 돌리지 않았다**(룰은 이미 적용돼 있어 추가 upgrade 불필요):
```bash
kubectl set image deploy/dp-dailyproof-web web=dailyproof-web:sec -n dailyproof
kubectl rollout status deploy/dp-dailyproof-web -n dailyproof
# /metrics에 security_events 복귀 확인 → 트래픽 → 알림 SecurityRateLimitSpike state=firing
```

**근본 해결(선언형으로 일원화)**: 이미지를 명령형으로 바꾸지 말고 **차트 값으로** 박는다 —
`helm upgrade ... --set image.web.tag=sec` (또는 values 파일에 기록). 그러면 helm이 그 이미지를 "원하는 상태"로 알아서 다음 upgrade에도 유지된다. GitOps(ArgoCD)라면 값을 git에 커밋해 동기화한다.

## 교훈

- **명령형(`kubectl edit/set`)과 선언형(helm/ArgoCD)을 같은 리소스에 섞지 않는다.** 나중에 도는 선언형이 명령형 변경을 덮어쓴다. 임시 디버깅엔 명령형이 빠르지만, *영속이 필요하면 선언형(차트 값/ git)에 반영*해야 한다.
- **"사라진 메트릭"의 끝단부터 본다.** scrape 설정이 아니라 *이미지가 바뀐 것*이 원인이었다. 출력이 사라지면 그 출력을 내는 워크로드(이미지·버전)부터 확인한다.
- **port-forward 없이 클러스터 내부에서 API를 직접 질의**하면(일회성 curl pod) 로컬 터널 문제 없이 빠르게 진단된다.
