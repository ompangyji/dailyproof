# 회고: docker-compose vs k8s, 그리고 환경별 격리

NetworkPolicy·jaeger 작업 중 "왜 jaeger가 로컬엔 있는데 helm엔 없지?", "한 서버에서 둘 다 돌리면 jaeger가 섞이나?" 같은 의문이 이어졌다. 같은 컨테이너를 쓰는데도 **개발용(docker-compose)과 운영용(k8s)이 별개 세계**라는 걸 정리한 기록.

## docker-compose vs k8s/helm — 같은 컨테이너, 다른 목적

둘 다 "컨테이너로 앱을 띄운다"는 같지만 역할이 다르다.

| | docker-compose | k8s / helm |
|---|---|---|
| 목적 | 로컬 개발·빠른 재현 | 실서비스 운영(production) |
| 범위 | 내 PC 한 대 | 여러 노드 클러스터 |
| 스케일 | 수동 | 자동(HPA) |
| 죽으면 | 멈춤 | 자동 재시작·복구 |
| 무중단 배포·롤백 | 없음 | 있음(rolling update) |
| 네트워크 정책·시크릿 | 거의 없음 | NetworkPolicy·Secret 등 |
| 설정 | `docker-compose.yml` 1개 | helm 차트(여러 매니페스트) |

이 프로젝트가 둘 다 두는 이유: **"개발 → 운영"의 전 과정**을 보이려는 것. 개발은 compose로 빠르게, 운영 시연은 k8s(+Jenkins/ArgoCD)로.

## "자리표시자(placeholder)"의 의미

helm 설정엔 `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`이 있는데, **helm 차트엔 jaeger 자체가 없었다**(web·worker만 있고 jaeger Deployment 없음). 즉 "보낼 주소는 적혀 있는데 받을 대상이 그 환경엔 없는" 상태 — 이걸 자리표시자라 불렀다.

- **로컬(compose)**: jaeger가 실제로 떠 있어 UI(`localhost:16686`)로 트레이스를 본다.
- **k8s(helm)**: jaeger가 없어 트레이스 수신처가 없다(OTLP export가 조용히 실패해도 앱은 정상).

→ 그래서 `#66`에서 jaeger를 k8s에도 배포해 이 비대칭을 메운다.

**주의**: 같은 "자리표시자"여도 Jenkins·ArgoCD는 다르다 — 그건 `Jenkinsfile`·`application.yaml`이라는 **실체가 있는** 운영 구성이다. jaeger만 "k8s 배포가 후순위라 빠진" 케이스다.

## 한 서버에서 둘 다 돌려도 jaeger는 섞이지 않는다

"한 PC에서 compose와 k3s를 같이 돌리면 두 jaeger가 서로 보이나?" → **아니다. 격리된다.**

| | compose jaeger | k3s jaeger |
|---|---|---|
| 사는 네트워크 | Docker 네트워크 | k3s pod 네트워크 |
| 트래픽 출처 | compose의 web·worker | k3s의 web·worker |
| 내부 주소 | `jaeger:4318` (compose 안에서만 유효) | `jaeger:4318` (k3s 안에서만 유효) |

- **이름이 똑같이 `jaeger:4318`이어도, 각자 자기 네트워크 안에서만 해석된다.** compose web→compose jaeger, k3s web→k3s jaeger. 서로 못 본다.
- 이건 버그가 아니라 **의도된 격리** — 개발 트레이스와 운영 트레이스가 섞이면 안 된다.
- 다만 **호스트 포트는 충돌할 수 있다**: 둘 다 UI가 16686이라, compose는 `16686:16686`로 호스트에 직접 바인딩하고, k3s는 `kubectl port-forward`로 **다른 호스트 포트**(예: 16687)에 띄우면 동시에 따로 볼 수 있다.

## 교훈

- **컨테이너 기술이 같다고 환경이 같은 게 아니다.** compose(개발)와 k8s(운영)는 도구·격리·운영 모델이 다른 별개 세계다.
- **서비스 이름은 네트워크 경계 안에서만 유효하다.** 같은 `jaeger:4318`이라도 어느 네트워크(compose/k3s)에서 부르느냐로 대상이 갈린다 → 환경 격리의 본질.
- **설정에 주소가 있다고 대상이 그 환경에 있는 건 아니다**(자리표시자). 엔드포인트 존재와 백엔드 배포는 별개로 확인해야 한다.
