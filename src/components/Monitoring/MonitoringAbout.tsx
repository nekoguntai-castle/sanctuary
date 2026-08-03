import React from 'react';

export const MonitoringAbout: React.FC = () => (
  <div className="mt-8 surface-secondary rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700">
    <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
      About Monitoring
    </h4>
    <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
      The monitoring stack provides observability into Sanctuary's operation:
    </p>
    <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-2 space-y-1 list-disc list-inside">
      <li><strong>Grafana</strong> - Pre-configured dashboards for wallet sync, API performance, and system health</li>
      <li><strong>Prometheus</strong> - Metrics collection from backend /metrics endpoint</li>
      <li><strong>Jaeger</strong> - Distributed request tracing (requires OTEL_TRACING_ENABLED=true)</li>
    </ul>
  </div>
);
