import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // No Sentry org/project is configured yet, so keep this to the minimal
  // wrapping needed for the SDK to inject correctly at build/runtime.
  // Source map upload (and the auth token it needs) stays disabled.
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: true,
  },
});
