export interface ComputationalPrivateReportMetricFixture {
  name: string;
  passed: true;
  source: 'private_raw_report';
  threshold: number;
  value: number;
}

export function privateRawReportMetric(
  name: string,
  threshold: number,
  value: number,
): ComputationalPrivateReportMetricFixture {
  return {
    name,
    passed: true,
    source: 'private_raw_report',
    threshold,
    value,
  };
}
