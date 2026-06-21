# 시크릿 관리 (secret management)

시크릿(예: `SUPABASE_SERVICE_ROLE_KEY`)을 **git에 평문으로 올리지 않으면서도 GitOps의 source of truth에 포함**시키는 방법. sealed-secrets로 암호화해 커밋한다.

## 이전 방식과 그 한계

차트의 `secret.yaml`은 `.Values.secrets`를 k8s Secret으로 렌더하고, 실값은 **`values-secret.yaml`(gitignored) / `--set` / `argocd app set -p`** 로 주입했다.

- ✅ git엔 빈 placeholder만 → 평문이 git에 안 올라감.
- ⚠️ **한계**: 실값이 클러스터/로컬에만 존재 → **GitOps "git이 source of truth"가 시크릿만 깨짐.** 누가 어디서 주입했는지 추적 안 되고, 재해 복구·재현 시 수동 주입에 의존(휴먼 의존).

## sealed-secrets — 암호화해서 git에 커밋

**원리**: 클러스터에 설치한 **컨트롤러**가 비대칭 키쌍을 갖는다. `kubeseal`(공개키로 암호화)로 만든 **SealedSecret**은 **그 클러스터의 컨트롤러(개인키)만 복호화**할 수 있다. 그래서 암호문을 **git에 커밋해도 안전**하고, 컨트롤러가 SealedSecret → 진짜 Secret으로 자동 복호화한다.

```
평문 Secret → (kubeseal, 공개키 암호화) → SealedSecret[git 커밋] → (컨트롤러, 개인키 복호화) → Secret[클러스터]
```

- **왜 sealed-secrets인가(vs external-secrets)**: external-secrets는 외부 시크릿 store(Vault·AWS Secrets Manager 등)가 전제다. 이 프로젝트엔 외부 store가 없고 단일 클러스터라, "암호화해 git에 커밋"하는 sealed-secrets가 정확히 맞는다. 클라우드 시크릿 매니저를 도입하면 그때 external-secrets로 전환 검토.

## 설치

```bash
# 컨트롤러(클러스터)
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.38.1/controller.yaml
kubectl get pods -n kube-system | grep sealed-secrets   # Running 확인

# kubeseal CLI (로컬)
curl -sL -o kubeseal.tar.gz https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.38.1/kubeseal-0.38.1-linux-amd64.tar.gz
tar -xzf kubeseal.tar.gz kubeseal && sudo install -m 755 kubeseal /usr/local/bin/kubeseal
```

## 봉인(seal) 절차

평문을 직접 타이핑/출력하지 않도록, **이미 클러스터에 있는 Secret을 파이프로 통과**시켜 봉인한다(평문은 화면에 안 뜨고 암호문만 파일로 나간다).

```bash
kubectl get secret dp-dailyproof-secret -n dailyproof -o yaml \
  | kubeseal --controller-namespace kube-system --format yaml \
  > deploy/sealed-secrets/dailyproof-secret.yaml
```

- 결과 파일(`deploy/sealed-secrets/dailyproof-secret.yaml`)은 `kind: SealedSecret` + `encryptedData`(암호문)만 담는다 → **git 커밋 대상**(`.gitignore`의 일반 secret 패턴에서 이 디렉토리는 예외).
- **봉인은 namespace+name에 묶인다**(기본 strict scope): 같은 암호문을 다른 네임스페이스/이름으로는 복호화 못 한다.

## 적용·복구

```bash
kubectl apply -f deploy/sealed-secrets/dailyproof-secret.yaml
kubectl get sealedsecret,secret -n dailyproof | grep dailyproof-secret
# → SealedSecret과 (컨트롤러가 복호화한) Secret이 둘 다 보이면 동작.
```

**재해 복구 주의**: SealedSecret을 복호화하는 건 **컨트롤러의 개인키**다. 클러스터를 새로 만들면 키가 달라져 기존 SealedSecret을 못 푼다. 따라서 **컨트롤러의 봉인 키(`kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key`)를 안전한 곳에 백업**하거나, 새 클러스터의 공개키로 **재봉인(reseal)** 해야 한다. (이 키 백업은 그 자체가 민감 → 오프라인/암호화 보관.)

## 키 회전(rotation) 시

평문 키를 회전하면(예: Supabase service_role 재발급): ① 클러스터 Secret을 새 값으로 갱신 → ② 위 봉인 절차로 SealedSecret 재생성 → ③ git 커밋. 컨트롤러 키 자체의 주기적 회전은 컨트롤러가 자동(기본 30일)으로 새 키를 추가하며, 옛 키도 복호화용으로 유지한다.

## 검증 기록

- 컨트롤러 설치(`Running`) + `kubeseal 0.38.1` → 기존 Secret 봉인 → apply → `kubectl get sealedsecret,secret`에 **둘 다** 표시(암호문 커밋 → 컨트롤러 복호화 → 실제 Secret 생성 동작 확인).
- 봉인 파일에 JWT 평문(`eyJ…`) 0건, `encryptedData`만 → 커밋 안전.

## 후속

- ArgoCD 동기화 대상에 SealedSecret 포함(현재는 수동 apply로 검증, GitOps 흐름 통합은 후속).
- 컨트롤러 봉인 키 백업 절차를 운영 런북에 정식화.
