# 회고: Prometheus·Grafana·Alertmanager는 각각 뭘 하나

kube-prometheus-stack을 깔고 보니 UI가 여러 개(Prometheus·Grafana·Alertmanager)였고, "같은 메트릭인데 왜 화면이 여러 개지?"가 헷갈렸다. 각 컴포넌트의 역할과 데이터 흐름을 정리한다.

## 한 줄 요약

- **Prometheus** = 메트릭을 **수집·저장하고 알림 룰을 평가**하는 엔진.
- **Alertmanager** = Prometheus가 발동한 알림을 **받아 그룹핑·라우팅·발송**하는 알림 배달부.
- **Grafana** = 그 메트릭을 **대시보드로 시각화**하는 화면(데이터를 직접 소유하지 않음).

## 데이터 흐름

```
[web /metrics]  ──scrape──▶  [Prometheus]  ──룰 평가: 조건 충족──▶  [Alertmanager]  ──그룹핑·발송──▶ (Slack/메일/…)
                                  │  저장(TSDB)
                                  └──쿼리(PromQL)──▶  [Grafana]  (시각화)
```

- 진실의 원천(메트릭 저장)은 **Prometheus** 하나다.
- **Grafana는 데이터를 갖지 않는다** — Prometheus에 PromQL로 물어봐서 그릴 뿐. (Loki·다른 소스도 같은 방식으로 붙여 한 화면에 통합)
- **알림의 "판단"은 Prometheus**(룰 평가 → firing), **알림의 "배달"은 Alertmanager**(중복 묶기·라우팅·외부 발송). 둘은 역할이 다르다.

## Prometheus UI vs Grafana UI

| | Prometheus UI | Grafana UI |
|---|---|---|
| 주 역할 | 수집·저장·**알림 룰 평가** | **시각화·대시보드** |
| 데이터 소유 | 자기 TSDB | 없음(Prometheus에서 빌림) |
| 쿼리 | PromQL(디버깅용 기본 그래프) | 같은 PromQL을 패널/대시보드로 |
| 알림 | 룰 firing(본체) | 보기 위주 |
| 여러 소스 | Prometheus 하나 | 여러 소스 통합 |
| 주 사용자 | 개발자(디버깅·룰 확인) | 팀 상시 모니터링 화면 |

비유: **Prometheus = 창고 + 경보장치**(데이터 쌓고 조건 되면 경보), **Grafana = 전광판**(그 데이터를 보기 좋게 띄움, 직접 소유 X), **Alertmanager = 경보가 울리면 누구에게 어떻게 알릴지 처리하는 배달부**.

## Alertmanager가 따로 있는 이유

Prometheus가 "조건 충족(firing)"을 판단하면, 그걸 사람에게 알리는 일은 별도 관심사다:
- **그룹핑**: 같은 류 알림 여러 개를 한 번에 묶어 알림 폭주 방지.
- **억제(inhibition)·침묵(silence)**: 상위 장애가 있으면 하위 알림 억제, 점검 중엔 침묵.
- **라우팅·발송**: 심각도·팀별로 Slack/메일/PagerDuty 등 목적지 분기.

이 데모에선 **외부 발송 없이 firing이 Alertmanager까지 전달되는 것까지** 확인했다(발송 연동은 webhook 비밀·설정이 더 들어 [추후]).

## 교훈

- **"같은 데이터, 다른 화면"** — 메트릭은 Prometheus에 하나로 저장되고, Grafana는 그걸 *보여주기만* 한다. 값이 같다고 같은 시스템이 아니다.
- **판단과 배달을 분리** — Prometheus(룰 평가)와 Alertmanager(알림 처리)가 나뉜 건 관심사 분리다. 알림 정책(그룹핑·라우팅)을 메트릭 엔진과 독립적으로 운영하기 위함.
