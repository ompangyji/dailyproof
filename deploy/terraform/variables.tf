variable "kubeconfig" {
  description = "kubeconfig 경로"
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "kube 컨텍스트(로컬 k3s는 default)"
  type        = string
  default     = "default"
}

variable "namespace" {
  description = "배포 네임스페이스"
  type        = string
  default     = "dailyproof"
}

variable "release_name" {
  description = "helm 릴리스 이름"
  type        = string
  default     = "dp"
}

variable "environment" {
  description = "환경 override 선택 (staging|prod)"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "supabase_service_role_key" {
  description = "worker용 service_role 시크릿 (커밋 금지)"
  type        = string
  sensitive   = true
}

variable "next_public_supabase_url" {
  description = "Supabase 프로젝트 URL (공개값)"
  type        = string
}

variable "next_public_supabase_anon_key" {
  description = "Supabase anon 키 (공개값, RLS로 보호)"
  type        = string
}
