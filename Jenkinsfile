pipeline {
    agent any
    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 25, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '5'))
    }
    environment {
        CI = 'true'
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    }
    stages {
        stage('Install') {
            steps {
                sh 'node --version && npm ci'
                sh 'mkdir -p test-results'
            }
        }
        stage('Checks') {
            parallel {
                stage('Lint') {
                    steps { sh 'npm run lint' }
                }
                stage('Type check') {
                    steps { sh 'npm run typecheck' }
                }
                stage('Unit tests') {
                    steps { sh 'npm run test:ci' }
                    post {
                        always {
                            junit testResults: 'test-results/*.xml', allowEmptyResults: false
                        }
                    }
                }
                stage('Privacy') {
                    steps { sh 'npm run --silent privacy > test-results/privacy.json' }
                }
            }
        }
        stage('Build app') {
            steps {
                sh 'npm run build'
                sh 'npm run analytics:check'
                sh 'git diff --exit-code -- public/react public/vendor/workload.mjs'
            }
        }
        stage('Build Docker image') {
            steps {
                sh '''
                    docker build --target runtime -t "${LIFEOS_JENKINS_IMAGE}:jenkins-${BUILD_NUMBER}" .
                    docker image inspect --format '{{.Id}}' "${LIFEOS_JENKINS_IMAGE}:jenkins-${BUILD_NUMBER}" > test-results/image-id.txt
                '''
            }
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'test-results/**', allowEmptyArchive: true, fingerprint: true
        }
        cleanup {
            deleteDir()
        }
    }
}
