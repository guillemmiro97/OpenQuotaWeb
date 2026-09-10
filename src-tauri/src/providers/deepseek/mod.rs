mod client;

use std::sync::Arc;

use chrono::Utc;
use reqwest::StatusCode;
use serde_json::Value;
use thiserror::Error;

use crate::{
    models::{
        ApiKeyStatus, MetricDefinition, MetricSection, MetricValue, MetricValueKind,
        ProviderDefinition, ProviderErrorKind, ProviderLink, ProviderSnapshot, UsageHistory,
        ValueMetric,
    },
    providers::api_key::ApiKeyStore,
};

use self::client::DeepSeekClient;
use super::{ProviderError, UsageProvider};

const ENVIRONMENT_NAMES: &[&str] = &["DEEPSEEK_API_KEY"];
const CONFIG_PATHS: &[&str] = &["~/.config/deepseek/key.json"];

pub(crate) fn definition() -> ProviderDefinition {
    ProviderDefinition {
        id: "deepseek".into(),
        display_name: "DeepSeek".into(),
        short_name: "DS".into(),
        fallback_enabled: false,
        local_usage_source_note: None,
        links: vec![
            ProviderLink::new("Usage", "https://platform.deepseek.com/usage"),
            ProviderLink::new("API Keys", "https://platform.deepseek.com/api_keys"),
        ],
        metrics: vec![
            MetricDefinition::value(
                "deepseek.balance",
                "Balance",
                "balance",
                true,
                MetricSection::AlwaysVisible,
                true,
                "B",
                None,
            ),
            MetricDefinition::value(
                "deepseek.granted",
                "Granted",
                "granted",
                true,
                MetricSection::OnDemand,
                false,
                "G",
                None,
            ),
            MetricDefinition::value(
                "deepseek.toppedUp",
                "Topped Up",
                "toppedUp",
                true,
                MetricSection::OnDemand,
                false,
                "T",
                None,
            ),
        ],
    }
}

#[derive(Debug, Error)]
enum DeepSeekError {
    #[error("Add a DeepSeek API key in Customize to view your balance.")]
    MissingKey,
    #[error("The DeepSeek API key is invalid. Check it at platform.deepseek.com/api_keys.")]
    InvalidKey,
    #[error("Could not reach DeepSeek. Check your internet connection.")]
    ConnectionFailed,
    #[error("DeepSeek balance data is temporarily unavailable.")]
    InvalidResponse,
    #[error("DeepSeek request failed (HTTP {0}).")]
    RequestFailed(u16),
    #[error("The DeepSeek API key could not be read or updated.")]
    CredentialStorage,
}

impl From<DeepSeekError> for ProviderError {
    fn from(error: DeepSeekError) -> Self {
        let kind = match error {
            DeepSeekError::MissingKey | DeepSeekError::InvalidKey => {
                ProviderErrorKind::Authentication
            }
            DeepSeekError::ConnectionFailed => ProviderErrorKind::Network,
            DeepSeekError::RequestFailed(429) => ProviderErrorKind::RateLimited,
            DeepSeekError::RequestFailed(401 | 403) => ProviderErrorKind::Authentication,
            DeepSeekError::RequestFailed(_) | DeepSeekError::InvalidResponse => {
                ProviderErrorKind::InvalidResponse
            }
            DeepSeekError::CredentialStorage => ProviderErrorKind::CredentialStorage,
        };
        ProviderError::new(kind, error.to_string())
    }
}

pub struct DeepSeekProvider {
    auth: ApiKeyStore,
    client: Arc<DeepSeekClient>,
}

impl DeepSeekProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            auth: ApiKeyStore::new_with_sources("deepseek", ENVIRONMENT_NAMES, CONFIG_PATHS),
            client: Arc::new(DeepSeekClient::new().map_err(ProviderError::from)?),
        })
    }

    fn refresh_snapshot(&self, api_key: &str) -> Result<ProviderSnapshot, ProviderError> {
        let response = self
            .client
            .fetch_balance(api_key)
            .map_err(ProviderError::from)?;
        if matches!(
            response.status,
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        ) {
            return Err(DeepSeekError::InvalidKey.into());
        }
        if !response.status.is_success() {
            return Err(DeepSeekError::RequestFailed(response.status.as_u16()).into());
        }

        let infos = response
            .body
            .get("balance_infos")
            .and_then(Value::as_array)
            .filter(|infos| !infos.is_empty())
            .ok_or_else(|| ProviderError::from(DeepSeekError::InvalidResponse))?;
        let info = &infos[0];
        let currency = info
            .get("currency")
            .and_then(Value::as_str)
            .unwrap_or("USD")
            .to_owned();

        let mut values = Vec::new();
        if let Some(total) = number(info.get("total_balance")) {
            values.push(currency_value("balance", "Balance", total, &currency));
        }
        values.push(currency_value(
            "granted",
            "Granted",
            number(info.get("granted_balance")).unwrap_or(0.0),
            &currency,
        ));
        values.push(currency_value(
            "toppedUp",
            "Topped Up",
            number(info.get("topped_up_balance")).unwrap_or(0.0),
            &currency,
        ));
        if values.is_empty() {
            return Err(DeepSeekError::InvalidResponse.into());
        }

        Ok(ProviderSnapshot {
            provider_id: "deepseek".into(),
            plan: None,
            quotas: Vec::new(),
            value_metrics: values,
            status_metrics: Vec::new(),
            notices: Vec::new(),
            usage: UsageHistory::default(),
            warnings: Vec::new(),
            refreshed_at: Utc::now(),
        })
    }
}

impl UsageProvider for DeepSeekProvider {
    fn definition(&self) -> ProviderDefinition {
        definition()
    }

    fn has_local_credentials(&self) -> bool {
        self.auth.load().is_ok_and(|key| key.is_some())
    }

    fn refresh(&self) -> Result<ProviderSnapshot, ProviderError> {
        let api_key = self
            .auth
            .load()
            .map_err(|_| ProviderError::from(DeepSeekError::CredentialStorage))?
            .ok_or_else(|| ProviderError::from(DeepSeekError::MissingKey))?;
        self.refresh_snapshot(api_key.as_str())
    }

    fn api_key_status(&self) -> Option<Result<ApiKeyStatus, ProviderError>> {
        Some(
            self.auth
                .status()
                .map_err(|_| ProviderError::from(DeepSeekError::CredentialStorage)),
        )
    }

    fn supports_api_key_configuration(&self) -> bool {
        true
    }

    fn save_api_key(&self, value: &str) -> Result<(), ProviderError> {
        self.auth
            .save(value)
            .map_err(|_| ProviderError::from(DeepSeekError::CredentialStorage))
    }

    fn delete_api_key(&self) -> Result<(), ProviderError> {
        self.auth
            .delete()
            .map_err(|_| ProviderError::from(DeepSeekError::CredentialStorage))
    }
}

fn currency_value(id: &str, label: &str, number: f64, currency: &str) -> ValueMetric {
    ValueMetric {
        id: id.into(),
        label: label.into(),
        values: vec![MetricValue {
            number,
            kind: MetricValueKind::Count,
            label: Some(currency.to_owned()),
            estimated: false,
        }],
        expiries_at: Vec::new(),
    }
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .filter(|value| value.is_finite())
}
