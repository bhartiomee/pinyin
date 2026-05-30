import { pinyin } from 'pinyin-pro';

const HTML_TAG_RE = /<\/?(font|i|b|ruby|rt|rp|span|div|br|p|c|v|lang|em|strong)[^>]*>/gi;
const ANY_TAG_RE = /<[^>]*>/g;
const CHINESE_CHARS_RE = /[\u4e00-\u9fff]/g;

export function cleanChineseText(input) {
  return String(input || '')
    .replace(HTML_TAG_RE, ' ')
    .replace(ANY_TAG_RE, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function convertToPinyin(text) {
  try {
    const cleaned = cleanChineseText(text);

    if (!cleaned) {
      return '';
    }

    // Extract only Chinese characters to check if conversion is needed
    const chineseChars = cleaned.match(CHINESE_CHARS_RE);
    if (!chineseChars || !chineseChars.length) {
      // No Chinese characters found, return empty
      return '';
    }

    // Convert the entire text (pinyin-pro will handle non-Chinese characters)
    const result = pinyin(cleaned, {
      toneType: 'symbol',
      type: 'array',
      nonZh: 'consecutive'
    }).join(' ');
    
    return result || '';
  } catch (error) {
    console.error('Pinyin conversion error:', error);
    return '';
  }
}
