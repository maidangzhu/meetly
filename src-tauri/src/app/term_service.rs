//! Narrow JSON path for live industry-term explanations.
//!
//! This is not a glossary. The selected industry is passed through to the
//! model, and the model decides whether a transcript line contains jargon.
//! Acronym examples in the prompt are conditional illustrations only.

use crate::providers::llm::build_from_saved_config;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const MAX_TERMS: usize = 4;
const MAX_TERM_CHARS: usize = 48;
const MAX_EXPLANATION_CHARS: usize = 240;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TermExplanation {
    pub term: String,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TermDetection {
    pub terms: Vec<TermExplanation>,
}

#[derive(Debug, Deserialize)]
struct TermResponse {
    #[serde(default)]
    terms: Vec<RawTerm>,
}

#[derive(Debug, Deserialize)]
struct RawTerm {
    #[serde(default)]
    term: String,
    #[serde(default)]
    explanation: String,
}

pub fn build_term_system_prompt(industry: &str) -> String {
    format!(
        "你是行业术语解释器。用户正在听实时转写，只想看懂自己不熟的行话。\n\
当前听众的行业是：{industry}。\n\
只按这个行业解释。同一个缩写在不同行业意思不同，选择该行业日常对话里真正使用的那个意思。\n\
例如：行业是「CRO / 临床研究」时，CTA 指临床试验助理（Clinical Trial Assistant）；\
行业是「电商」时，CTA 可以指行动号召（call to action）。\n\
这些例子只说明规则，不是一张适用于所有行业的词表。\
当前行业不是「CRO / 临床研究」时，不要把 CTA 解释成临床试验助理。\
当前行业不是「电商」时，也不要默认 CTA 是行动号召。\
不要把某个行业的展开套到另一个行业上。不要把 CTA 解释成临床委托协议。\n\
如果按当前行业和这段转写，仍有两种同样说得通的意思，返回空列表，不要猜。\n\
\n\
只判断这段新转写里，是否出现当前行业听众可能听不懂的术语、缩写或行话。\n\
- 不确定，或只是日常用词，返回空列表。默认保持安静。\n\
- explanation 用一两句口语中文，大白话。不要建议、不要下一步、不要教用户怎么回答。\n\
- 没有需要解释的术语时，不要为了说话而说话。\n\
\n\
只返回一个 JSON 对象，形状为 {{\"terms\":[{{\"term\":string,\"explanation\":string}}]}}。\n\
没有术语时返回 {{\"terms\":[]}}。不要输出 JSON 以外的文字。"
    )
}

pub fn build_term_user_message(industry: &str, transcript: &str) -> String {
    format!(
        "行业：{industry}\n\
下面是一句新的转写。只挑出当前行业里听众可能不懂的术语或缩写。\
没有就返回 {{\"terms\":[]}}。\n\n\
转写：\n{transcript}"
    )
}

pub fn parse_term_response(content: &str) -> Vec<TermExplanation> {
    let Some(json) = extract_json_object(content) else {
        return Vec::new();
    };
    let Ok(response) = serde_json::from_str::<TermResponse>(json) else {
        return Vec::new();
    };

    let mut terms = Vec::new();
    for item in response.terms {
        let Some(term) = clean_text(&item.term, MAX_TERM_CHARS) else {
            continue;
        };
        let Some(explanation) = clean_text(&item.explanation, MAX_EXPLANATION_CHARS) else {
            continue;
        };
        if is_coaching(&explanation) {
            continue;
        }
        terms.push(TermExplanation { term, explanation });
        if terms.len() == MAX_TERMS {
            break;
        }
    }
    terms
}

fn clean_text(value: &str, max_chars: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(max_chars).collect())
}

fn is_coaching(explanation: &str) -> bool {
    explanation.contains("你应该")
        || explanation.contains("建议你")
        || explanation.contains("你可以这样说")
}

fn extract_json_object(content: &str) -> Option<&str> {
    let trimmed = strip_json_code_fence(content.trim());
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end < start {
        return None;
    }
    Some(&trimmed[start..=end])
}

fn strip_json_code_fence(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("```") else {
        return content;
    };
    let rest = rest
        .strip_prefix("json")
        .or_else(|| rest.strip_prefix("JSON"))
        .unwrap_or(rest)
        .trim_start();
    rest.strip_suffix("```").unwrap_or(rest).trim()
}

#[tauri::command]
pub async fn explain_transcript_terms(
    app: AppHandle,
    industry: String,
    transcript: String,
) -> Result<TermDetection, String> {
    let industry = industry.trim();
    let transcript = transcript.trim();
    if industry.is_empty() || transcript.is_empty() {
        return Ok(TermDetection { terms: Vec::new() });
    }

    let provider = build_from_saved_config(&app).map_err(|error| error.to_string())?;
    let system_prompt = build_term_system_prompt(industry);
    let user_message = build_term_user_message(industry, transcript);
    let content = match provider
        .complete_text(system_prompt, user_message, 0.1, true)
        .await
    {
        Ok(content) => content,
        Err(error) => {
            let _ = crate::debug_log::append(&format!(
                "[terms] model request failed industry={industry} error={error}"
            ));
            return Ok(TermDetection { terms: Vec::new() });
        }
    };

    Ok(TermDetection {
        terms: parse_term_response(&content),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cro_prompt_binds_cta_only_to_that_industry() {
        let prompt = build_term_system_prompt("CRO / 临床研究");
        assert!(prompt.contains("当前听众的行业是：CRO / 临床研究"));
        assert!(prompt.contains("只按这个行业解释"));
        assert!(prompt.contains(
            "行业是「CRO / 临床研究」时，CTA 指临床试验助理（Clinical Trial Assistant）"
        ));
        assert!(prompt.contains("当前行业不是「CRO / 临床研究」时，不要把 CTA 解释成临床试验助理"));
        assert!(prompt.contains("不要把 CTA 解释成临床委托协议"));
        assert!(prompt.contains("仍有两种同样说得通的意思，返回空列表"));
        assert!(prompt.contains("不要为了说话而说话"));
        assert!(prompt.contains("不要教用户怎么回答"));
        assert!(!prompt.contains("Meeting Coach"));
        assert!(!prompt.contains("Infer what the user should say"));
    }

    #[test]
    fn ecommerce_prompt_does_not_apply_the_cro_expansion() {
        let prompt = build_term_system_prompt("电商");
        assert!(prompt.contains("当前听众的行业是：电商"));
        assert!(prompt.contains("行业是「电商」时，CTA 可以指行动号召（call to action）"));
        assert!(prompt.contains("当前行业不是「CRO / 临床研究」时，不要把 CTA 解释成临床试验助理"));
        assert!(prompt.contains("不要把某个行业的展开套到另一个行业上"));
        assert!(!prompt.contains("本场把 CTA 解释为临床试验助理"));
        assert!(!prompt.contains("无论行业，CTA 都是临床试验助理"));
    }

    #[test]
    fn user_message_repeats_the_selected_industry_and_allows_silence() {
        let message = build_term_user_message("建筑", "我们先看这版图纸的标高。");
        assert!(message.contains("行业：建筑"));
        assert!(message.contains("{\"terms\":[]}"));
        assert!(message.contains("我们先看这版图纸的标高。"));
    }

    #[test]
    fn empty_model_response_produces_no_card() {
        assert!(parse_term_response("{\"terms\":[]}").is_empty());
        assert!(parse_term_response("这段没有术语。").is_empty());
        assert!(parse_term_response("").is_empty());
    }

    #[test]
    fn parser_keeps_model_text_and_has_no_industry_glossary() {
        let cro = parse_term_response(
            r#"{"terms":[{"term":"CTA","explanation":"临床试验助理，协助研究者处理试验现场事务。"}]}"#,
        );
        let shop = parse_term_response(
            r#"{"terms":[{"term":"CTA","explanation":"行动号召，希望对方现在就去做的那一步。"}]}"#,
        );
        assert_eq!(cro[0].term, "CTA");
        assert!(cro[0].explanation.contains("临床试验助理"));
        assert_eq!(shop[0].term, "CTA");
        assert!(shop[0].explanation.contains("行动号召"));
    }

    #[test]
    fn parser_drops_coaching_and_keeps_several_terms() {
        let terms = parse_term_response(
            r#"```json
            {"terms":[
              {"term":"CRA","explanation":"临床监查员，负责到研究中心核对试验执行情况。"},
              {"term":"GCP","explanation":"你应该按药物临床试验质量管理规范来回答。"},
              {"term":"  ","explanation":"空白"},
              {"term":"EDC","explanation":"电子数据采集系统，试验数据在里面录入。"}
            ]}
            ```"#,
        );
        assert_eq!(
            terms.iter().map(|term| term.term.as_str()).collect::<Vec<_>>(),
            vec!["CRA", "EDC"]
        );
    }
}
