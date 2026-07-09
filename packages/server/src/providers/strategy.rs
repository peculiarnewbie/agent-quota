//! Strategy pipeline helpers (CodexBar-shaped: ordered sources, first win).

use crate::types::ServiceUsage;

#[derive(Debug)]
pub enum StrategyError {
    /// No credentials / tools — skip to next strategy.
    Unavailable(String),
    /// Ran but failed — keep as last error; try next.
    Failed {
        message: String,
        hint: Option<String>,
        source: Option<String>,
    },
}

impl StrategyError {
    pub fn unavailable(msg: impl Into<String>) -> Self {
        Self::Unavailable(msg.into())
    }

    pub fn failed(
        message: impl Into<String>,
        hint: Option<String>,
        source: Option<String>,
    ) -> Self {
        Self::Failed {
            message: message.into(),
            hint,
            source,
        }
    }
}

pub type StrategyResult = Result<ServiceUsage, StrategyError>;

/// Accumulate strategy outcomes into a final `ServiceUsage`.
pub struct Pipeline<'a> {
    service: &'a str,
    no_creds_hint: &'a str,
    last_fail: Option<(String, Option<String>, Option<String>)>,
    any_available: bool,
    done: Option<ServiceUsage>,
}

impl<'a> Pipeline<'a> {
    pub fn new(service: &'a str, no_creds_hint: &'a str) -> Self {
        Self {
            service,
            no_creds_hint,
            last_fail: None,
            any_available: false,
            done: None,
        }
    }

    pub fn push(&mut self, result: StrategyResult) {
        if self.done.is_some() {
            return;
        }
        match result {
            Ok(usage) => {
                self.done = Some(usage);
            }
            Err(StrategyError::Unavailable(msg)) => {
                eprintln!("[{}] skip: {msg}", self.service);
            }
            Err(StrategyError::Failed {
                message,
                hint,
                source,
            }) => {
                self.any_available = true;
                eprintln!("[{}] failed: {message}", self.service);
                self.last_fail = Some((message, hint, source));
            }
        }
    }

    pub fn finish(self) -> ServiceUsage {
        if let Some(usage) = self.done {
            return usage;
        }
        if !self.any_available {
            return ServiceUsage::no_credentials(self.service, self.no_creds_hint);
        }
        if let Some((message, hint, source)) = self.last_fail {
            let mut usage = ServiceUsage::error(self.service, message);
            if let Some(h) = hint {
                usage = usage.with_hint(h);
            }
            if let Some(s) = source {
                usage = usage.with_source(s);
            }
            return usage;
        }
        ServiceUsage::no_credentials(self.service, self.no_creds_hint)
    }

    pub fn is_done(&self) -> bool {
        self.done.is_some()
    }
}
