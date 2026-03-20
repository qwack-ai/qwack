/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "qwack",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage ?? ""),
      home: "aws",
      providers: {
        aws: { region: "us-east-1" },
      },
    }
  },

  async run() {
    const githubClientId = new sst.Secret("GitHubClientId")
    const githubClientSecret = new sst.Secret("GitHubClientSecret")

    const table = new sst.aws.Dynamo("Qwack", {
      fields: {
        PK: "string",
        SK: "string",
        GSI1PK: "string",
        GSI1SK: "string",
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      globalIndexes: {
        GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" },
      },
      ttl: "ttl",
      transform: {
        table: {
          billingMode: "PAY_PER_REQUEST",
          pointInTimeRecovery: { enabled: true },
        },
      },
    })

    const vpc = new sst.aws.Vpc("QwackNet", { nat: "managed" })
    const cluster = new sst.aws.Cluster("QwackCompute", { vpc })

    const isProduction = $app.stage === "production"

    const service = new sst.aws.Service("QwackServer", {
      cluster,
      cpu: "0.25 vCPU",
      memory: "0.5 GB",
      link: [table, githubClientId, githubClientSecret],
      image: {
        dockerfile: "packages/qwack-server/Dockerfile",
        context: ".",
      },
      environment: {
        QWACK_PORT: "4000",
        QWACK_HOST: "0.0.0.0",
        QWACK_TABLE_NAME: table.name,
        AWS_REGION: "us-east-1",
        GITHUB_CLIENT_ID: githubClientId.value,
        GITHUB_CLIENT_SECRET: githubClientSecret.value,
        OPENAUTH_ISSUER_URL: $interpolate`http://localhost:4000`,
      },
      loadBalancer: {
        ...(isProduction
          ? {
              domain: { name: "api.qwack.ai", dns: sst.aws.dns({ zone: "Z10088723EK24FM0CDA5K" }) },
              rules: [
                { listen: "80/http", redirect: "443/https" },
                { listen: "443/https", forward: "4000/http" },
              ],
            }
          : {
              rules: [{ listen: "80/http", forward: "4000/http" }],
            }),
        health: {
          "4000/http": {
            path: "/health",
            interval: "30 seconds",
            healthyThreshold: 2,
            unhealthyThreshold: 3,
            timeout: "5 seconds",
          },
        },
      },
      scaling: { min: 1, max: 1 },
      dev: {
        command: "bun run --cwd packages/qwack-server src/index.ts",
      },
    })

    const landing = new sst.aws.StaticSite("QwackLanding", {
      path: "packages/qwack-web",
      build: { command: "bun run build", output: "dist" },
      ...(isProduction
        ? {
            domain: {
              name: "qwack.ai",
              dns: sst.aws.dns({ zone: "Z10088723EK24FM0CDA5K" }),
              aliases: ["www.qwack.ai"],
            },
          }
        : {}),
    })

    const docs = new sst.aws.StaticSite("QwackDocs", {
      path: "packages/docs",
      build: { command: "bun run build", output: "dist" },
      ...(isProduction
        ? { domain: { name: "docs.qwack.ai", dns: sst.aws.dns({ zone: "Z10088723EK24FM0CDA5K" }) } }
        : {}),
    })

    return {
      api: service.url,
      landing: landing.url,
      docs: docs.url,
      tableName: table.name,
    }
  },
})
