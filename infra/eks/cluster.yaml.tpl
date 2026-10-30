apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: eventmart
  region: us-east-1
  tags:
    project: eventmart

iam:
  withOIDC: true

vpc:
  id: "{{VPC_ID}}"
  clusterEndpoints:
    publicAccess: true
    privateAccess: true
  subnets:
    private:
      us-east-1a:
        id: "{{PRIVATE_SUBNET_A}}"
      us-east-1b:
        id: "{{PRIVATE_SUBNET_B}}"
    public:
      us-east-1a:
        id: "{{PUBLIC_SUBNET_A}}"
      us-east-1b:
        id: "{{PUBLIC_SUBNET_B}}"

managedNodeGroups:
  - name: eventmart-general
    instanceType: t3.medium
    desiredCapacity: 2
    minSize: 2
    maxSize: 4
    privateNetworking: true
    volumeSize: 20
    volumeType: gp3
    tags:
      project: eventmart
