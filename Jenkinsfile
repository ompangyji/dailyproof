// DailyProof CI — Jenkins 선언형 파이프라인.
// GitHub Actions(.github/workflows/ci.yml)와 "같은 검사"를 self-hosted Jenkins로 미러링한다:
//   typecheck+test / helm·terraform 검증 / docker build.
// 각 스테이지는 필요한 도구가 든 컨테이너 에이전트에서 돈다(컨트롤러에 도구 설치 불필요).
// agent none + 스테이지별 docker 에이전트라, 각 스테이지가 checkout scm으로 소스를 받는다.
// 전제: Jenkins가 Docker(소켓)에 접근 가능 + Docker Pipeline 플러그인. (runbooks/jenkins.md)
pipeline {
  agent none
  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
  }

  stages {
    stage('typecheck + tests') {
      agent { docker { image 'node:22' } }
      steps {
        checkout scm
        sh 'npm ci'
        sh 'npx tsc --noEmit'
        sh 'npm test'
      }
    }

    stage('helm lint') {
      // alpine/helm은 ENTRYPOINT가 helm이라 Jenkins의 cat이 안 돈다 → entrypoint 비움.
      agent { docker { image 'alpine/helm:latest'; args '--entrypoint=' } }
      steps {
        checkout scm
        sh 'helm lint deploy/helm/dailyproof'
        sh 'helm template dp deploy/helm/dailyproof -f deploy/helm/dailyproof/values-staging.yaml > /dev/null'
        sh 'helm template dp deploy/helm/dailyproof -f deploy/helm/dailyproof/values-prod.yaml > /dev/null'
      }
    }

    stage('terraform validate') {
      // hashicorp/terraform도 ENTRYPOINT가 terraform이라 동일 처리.
      agent { docker { image 'hashicorp/terraform:latest'; args '--entrypoint=' } }
      steps {
        checkout scm
        sh 'terraform -chdir=deploy/terraform fmt -check'
        sh 'terraform -chdir=deploy/terraform init -backend=false'
        sh 'terraform -chdir=deploy/terraform validate'
      }
    }

    stage('docker build') {
      // 호스트 도커 데몬을 소켓으로 공유해 이미지 빌드(GitHub Actions의 images 잡과 동일).
      agent { docker { image 'docker:cli'; args '-v /var/run/docker.sock:/var/run/docker.sock' } }
      steps {
        checkout scm
        sh 'docker build -f Dockerfile.worker -t dailyproof-worker:ci .'
        sh '''docker build -f Dockerfile.web \
          --build-arg NEXT_PUBLIC_SUPABASE_URL=https://ci-dummy.supabase.co \
          --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy \
          -t dailyproof-web:ci .'''
      }
    }
  }
}
