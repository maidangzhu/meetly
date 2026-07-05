use futures_util::task::AtomicWaker;
use ringbuf::traits::Consumer;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

pub(crate) struct PollNextSample {
    pub(crate) poll: Poll<Option<f32>>,
    pub(crate) did_pop_chunk: bool,
}

pub(crate) struct RingbufAsyncReader<C> {
    consumer: C,
    waker: Arc<AtomicWaker>,
    wake_pending: Arc<AtomicBool>,
    dropped_samples: Option<Arc<AtomicUsize>>,
    read_buffer: Vec<f32>,
    read_len: usize,
    read_idx: usize,
}

impl<C> RingbufAsyncReader<C>
where
    C: Consumer<Item = f32>,
{
    pub(crate) fn new(
        consumer: C,
        waker: Arc<AtomicWaker>,
        wake_pending: Arc<AtomicBool>,
        read_buffer: Vec<f32>,
    ) -> Self {
        Self {
            consumer,
            waker,
            wake_pending,
            dropped_samples: None,
            read_buffer,
            read_len: 0,
            read_idx: 0,
        }
    }

    pub(crate) fn with_dropped_samples(mut self, dropped_samples: Arc<AtomicUsize>) -> Self {
        self.dropped_samples = Some(dropped_samples);
        self
    }

    pub(crate) fn has_buffered_samples(&self) -> bool {
        self.read_idx < self.read_len
    }

    fn drain_dropped_counter(&mut self) {
        if let Some(dropped_samples) = &self.dropped_samples {
            let _ = dropped_samples.swap(0, Ordering::Relaxed);
        }
    }

    fn try_pop_chunk(&mut self) -> Option<usize> {
        let popped = self.consumer.pop_slice(&mut self.read_buffer);

        if popped > 0 {
            self.read_len = popped;
            self.read_idx = 0;
            self.wake_pending.store(false, Ordering::Release);
            Some(popped)
        } else {
            None
        }
    }

    fn poll_ready_chunk(&mut self, cx: &mut Context<'_>) -> Option<bool> {
        self.drain_dropped_counter();

        if self.try_pop_chunk().is_some() {
            return Some(true);
        }

        self.wake_pending.store(true, Ordering::Release);
        self.waker.register(cx.waker());

        if self.try_pop_chunk().is_some() {
            return Some(true);
        }

        self.wake_pending.store(true, Ordering::Release);
        None
    }

    pub(crate) fn poll_next_sample(&mut self, cx: &mut Context<'_>) -> PollNextSample {
        if self.read_idx < self.read_len {
            let sample = self.read_buffer[self.read_idx];
            self.read_idx += 1;
            return PollNextSample {
                poll: Poll::Ready(Some(sample)),
                did_pop_chunk: false,
            };
        }

        match self.poll_ready_chunk(cx) {
            Some(true) => {
                let sample = self.read_buffer[0];
                self.read_idx = 1;
                PollNextSample {
                    poll: Poll::Ready(Some(sample)),
                    did_pop_chunk: true,
                }
            }
            Some(false) => PollNextSample {
                poll: Poll::Ready(None),
                did_pop_chunk: false,
            },
            None => PollNextSample {
                poll: Poll::Pending,
                did_pop_chunk: false,
            },
        }
    }
}
