type EnvName =
  | "UPLOAD_PASSWORD"
  | "ADMIN_PASSWORD"
  | "AUTH_SECRET"
  | "POSTGRES_URL"
  | "POSTGRES_URL_NON_POOLING"
  | "POSTGRES_PRISMA_URL"
  | "POSTGRES_USER"
  | "POSTGRES_HOST"
  | "POSTGRES_PASSWORD"
  | "POSTGRES_DATABASE"
  | "BLOB_READ_WRITE_TOKEN";

type RequiredServerEnv = {
  uploadPassword: string;
  adminPassword: string;
  authSecret: string;
  postgresUrl: string;
  blobReadWriteToken: string;
};

type OptionalPostgresEnv = {
  postgresUrlNonPooling?: string;
  postgresPrismaUrl?: string;
  postgresUser?: string;
  postgresHost?: string;
  postgresPassword?: string;
  postgresDatabase?: string;
};

export type ServerEnv = RequiredServerEnv & OptionalPostgresEnv;

function readRequiredEnv(name: EnvName): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: EnvName): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getServerEnv(): ServerEnv {
  return {
    uploadPassword: readRequiredEnv("UPLOAD_PASSWORD"),
    adminPassword: readRequiredEnv("ADMIN_PASSWORD"),
    authSecret: readRequiredEnv("AUTH_SECRET"),
    postgresUrl: readRequiredEnv("POSTGRES_URL"),
    blobReadWriteToken: readRequiredEnv("BLOB_READ_WRITE_TOKEN"),
    postgresUrlNonPooling: readOptionalEnv("POSTGRES_URL_NON_POOLING"),
    postgresPrismaUrl: readOptionalEnv("POSTGRES_PRISMA_URL"),
    postgresUser: readOptionalEnv("POSTGRES_USER"),
    postgresHost: readOptionalEnv("POSTGRES_HOST"),
    postgresPassword: readOptionalEnv("POSTGRES_PASSWORD"),
    postgresDatabase: readOptionalEnv("POSTGRES_DATABASE"),
  };
}
