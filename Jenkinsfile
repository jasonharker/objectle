// Jenkinsfile for objectle: test, then build the image. Modelled on city-pulse's.
// The registry address is not in this public repo: it comes from the Jenkins
// global environment variable LAN_REGISTRY.
//
// No Deploy stage yet: city-pulse's deploy rewrites its image line in the
// thales-kubernetes manifests, and objectle's manifests don't exist yet. Add the
// stage when they do.

pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
metadata:
  labels:
    jenkins: agent
spec:
  serviceAccountName: jenkins
  containers:
  - name: node
    image: node:26.13.1-alpine3.24
    command:
    - sleep
    args:
    - 99d
  - name: kaniko
    image: gcr.io/kaniko-project/executor:debug
    command:
    - sleep
    args:
    - 99d
"""
        }
    }

    environment {
        IMAGE_NAME = 'objectle'
        PNPM = 'npx --yes pnpm@12.23.0'
    }

    stages {
        stage('Test') {
            steps {
                container('node') {
                    sh '$PNPM install --frozen-lockfile && $PNPM typecheck && $PNPM test && $PNPM build'
                }
            }
        }

        stage('Build Image') {
            when { branch 'main' }
            steps {
                container('kaniko') {
                    script {
                        if (!env.LAN_REGISTRY) {
                            error 'LAN_REGISTRY is not set in the Jenkins global environment'
                        }
                    }
                    sh """
                        /kaniko/executor \\
                            --context=\$(pwd) \\
                            --dockerfile=Dockerfile \\
                            --destination=\${LAN_REGISTRY}/${IMAGE_NAME}:${GIT_COMMIT.take(8)} \\
                            --insecure \\
                            --skip-tls-verify \\
                            --cache=true \\
                            --cache-repo=\${LAN_REGISTRY}/${IMAGE_NAME}-cache
                    """
                }
            }
        }
    }

    post {
        success {
            echo "Built ${IMAGE_NAME}:${GIT_COMMIT.take(8)}"
        }
    }
}
