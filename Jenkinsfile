// Jenkinsfile for objectle: test, then build the image. Modelled on city-pulse's.
// The registry address is not in this public repo: it comes from the Jenkins
// global environment variable LAN_REGISTRY.
//
// A green main build is deployed by rewriting the image line (marked
// `# objectle-image`) in thales-kubernetes, which Flux then applies.

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
  - name: git
    image: alpine/git:latest
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
        MANIFEST_REPO = 'git@github.com:jasonharker/thales-kubernetes.git'
        MANIFEST_FILES = 'apps/objectle/deployment.yaml'
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

        stage('Deploy') {
            when { branch 'main' }
            steps {
                container('git') {
                    withCredentials([sshUserPrivateKey(credentialsId: 'github-ssh-deploy-key', keyFileVariable: 'SSH_KEY')]) {
                        script {
                            def shortCommit = GIT_COMMIT.take(8)
                            sh """
                                git config --global user.email "jenkins@users.noreply.github.com"
                                git config --global user.name "Jenkins CI"
                                mkdir -p ~/.ssh
                                cp \${SSH_KEY} ~/.ssh/id_ed25519
                                chmod 600 ~/.ssh/id_ed25519
                                ssh-keyscan github.com >> ~/.ssh/known_hosts

                                git clone ${MANIFEST_REPO} k8s-manifests
                                cd k8s-manifests
                                sed -i "s|image: .* # objectle-image\$|image: \${LAN_REGISTRY}/${IMAGE_NAME}:${shortCommit} # objectle-image|" ${MANIFEST_FILES}
                                git diff ${MANIFEST_FILES}
                                git add ${MANIFEST_FILES}
                                git commit -m "🚀 Deploy ${IMAGE_NAME}:${shortCommit} (build #${BUILD_NUMBER})" || echo "No changes to commit"
                                git push origin main
                            """
                        }
                    }
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
