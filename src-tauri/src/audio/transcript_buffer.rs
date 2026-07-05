//! Rolling in-memory buffer of recent transcript segments. Not persisted to
//! disk by default (docs/PRD.md section 10). Held behind the same
//! `Arc<Mutex<...>>` pattern as the rest of `AudioState`.

use serde::Serialize;
use std::collections::VecDeque;

/// Maximum age of a segment before it's evicted from the buffer.
const MAX_AGE_MS: u64 = 180_000; // 3 minutes

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Default)]
pub struct TranscriptBuffer {
    segments: VecDeque<TranscriptSegment>,
}

impl TranscriptBuffer {
    pub fn push(&mut self, segment: TranscriptSegment) {
        self.segments.push_back(segment);
        self.evict_older_than(MAX_AGE_MS);
    }

    fn evict_older_than(&mut self, max_age_ms: u64) {
        let Some(newest_end_ms) = self.segments.back().map(|segment| segment.end_ms) else {
            return;
        };

        while let Some(front) = self.segments.front() {
            if newest_end_ms.saturating_sub(front.end_ms) > max_age_ms {
                self.segments.pop_front();
            } else {
                break;
            }
        }
    }

    /// Returns segments whose end time falls within the last `window_ms`,
    /// relative to the most recent segment, in chronological order.
    pub fn recent(&self, window_ms: u64) -> Vec<TranscriptSegment> {
        let Some(newest_end_ms) = self.segments.back().map(|segment| segment.end_ms) else {
            return Vec::new();
        };

        self.segments
            .iter()
            .filter(|segment| newest_end_ms.saturating_sub(segment.end_ms) <= window_ms)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: &str, start_ms: u64, end_ms: u64) -> TranscriptSegment {
        TranscriptSegment {
            id: id.to_string(),
            text: format!("segment {id}"),
            start_ms,
            end_ms,
        }
    }

    #[test]
    fn recent_filters_by_window() {
        let mut buffer = TranscriptBuffer::default();
        buffer.push(segment("a", 0, 1_000));
        buffer.push(segment("b", 50_000, 51_000));
        buffer.push(segment("c", 100_000, 101_000));

        let recent = buffer.recent(60_000);
        let ids: Vec<&str> = recent.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[test]
    fn evicts_segments_older_than_three_minutes() {
        let mut buffer = TranscriptBuffer::default();
        buffer.push(segment("old", 0, 1_000));
        buffer.push(segment("new", 200_000, 201_000));

        let all = buffer.recent(u64::MAX);
        let ids: Vec<&str> = all.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["new"]);
    }
}
