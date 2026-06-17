output "release_name" {
  description = "배포된 helm 릴리스 이름"
  value       = helm_release.dailyproof.name
}

output "release_namespace" {
  description = "릴리스 네임스페이스"
  value       = helm_release.dailyproof.namespace
}

output "release_status" {
  description = "릴리스 상태(deployed 등)"
  value       = helm_release.dailyproof.status
}
