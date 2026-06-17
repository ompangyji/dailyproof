# DailyProof IaC: Helm 차트를 로컬 k3s 클러스터에 helm_release로 배포한다.
# helm install을 직접 치는 대신 Terraform이 릴리스를 선언적으로 관리(생성/갱신/삭제).
#
# 실행:
#   cp terraform.tfvars.example terraform.tfvars   # 실값 채우기(gitignored)
#   terraform init && terraform apply
# 사전: 이미지가 k3s containerd에 import돼 있어야 파드가 뜬다(README/k8s-deploy.md 참고).

terraform {
  required_version = ">= 1.5"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

provider "helm" {
  kubernetes {
    config_path    = var.kubeconfig
    config_context = var.kube_context
  }
}

resource "helm_release" "dailyproof" {
  name             = var.release_name
  chart            = "${path.module}/../helm/dailyproof"
  namespace        = var.namespace
  create_namespace = true

  # 환경별 override(values-staging.yaml / values-prod.yaml)를 그대로 사용.
  values = [file("${path.module}/../helm/dailyproof/values-${var.environment}.yaml")]

  # 시크릿·공개키는 tfvars로 주입(차트에는 placeholder만). 실값은 커밋 금지.
  set_sensitive {
    name  = "secrets.SUPABASE_SERVICE_ROLE_KEY"
    value = var.supabase_service_role_key
  }
  set {
    name  = "config.NEXT_PUBLIC_SUPABASE_URL"
    value = var.next_public_supabase_url
  }
  set {
    name  = "config.NEXT_PUBLIC_SUPABASE_ANON_KEY"
    value = var.next_public_supabase_anon_key
  }
}
