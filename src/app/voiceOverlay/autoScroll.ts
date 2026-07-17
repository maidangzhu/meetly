export type ScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function isNearScrollBottom(metrics: ScrollMetrics, threshold = 40) {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}
