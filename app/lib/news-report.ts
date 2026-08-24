'use client';

import { loadLocalAiSettings } from './local-ai-settings.ts';
import { callConfiguredOpenAiSearch } from './ai-provider.ts';

export type GroundedSource = {
  title: string;
  uri: string;
};

export type GroundedNewsResult = {
  text: string;
  sources: GroundedSource[];
  queries: string[];
  generatedAt: string;
  searchEntryPointHtml: string;
  usedTimeFilter: boolean;
};

type GeminiPayload = {
  error?: { code?: number; message?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      searchEntryPoint?: { renderedContent?: string };
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
};

const MAX_RANGE_DAYS = 31;

function parseIsoDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function displayPeriod(fromDate: string, toDate: string) {
  const [fromYear, fromMonth, fromDay] = fromDate.split('-');
  const [toYear, toMonth, toDay] = toDate.split('-');
  if (fromDate === toDate) return `${toDay}/${toMonth}/${toYear}`;
  if (fromYear === toYear && fromMonth === toMonth) return `${fromDay}–${toDay}/${toMonth}/${toYear}`;
  if (fromYear === toYear) return `${fromDay}/${fromMonth}–${toDay}/${toMonth}/${toYear}`;
  return `${fromDay}/${fromMonth}/${fromYear}–${toDay}/${toMonth}/${toYear}`;
}

function nextIsoDay(value: string) {
  const date = parseIsoDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function validateNewsDateRange(fromDate: string, toDate: string): string {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (!from || !to) return 'Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.';
  if (from.getTime() > to.getTime()) return 'Ngày bắt đầu không được sau ngày kết thúc.';
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `Mỗi lần tìm tối đa ${MAX_RANGE_DAYS} ngày để đảm bảo tốc độ và độ chính xác.`;
  return '';
}

export function buildDailyNewsPrompt(
  fromDate: string,
  toDate: string,
  includeEconomicCalendar: boolean,
): string {
  const fromLabel = displayDate(fromDate);
  const toLabel = displayDate(toDate);
  const periodLabel = displayPeriod(fromDate, toDate);
  const periodDays = Math.floor(
    ((parseIsoDate(toDate)?.getTime() || 0) - (parseIsoDate(fromDate)?.getTime() || 0)) / 86_400_000,
  ) + 1;
  const newsSectionLabel = periodDays <= 2
    ? 'Tin tức trong ngày hôm qua và sáng nay'
    : 'Tin tức trong giai đoạn';
  const priceRule = fromDate === toDate
    ? `Đây là báo cáo cho đúng ngày ${fromLabel}. Chỉ dùng giá và tin trong ngày này.`
    : `Đây là báo cáo cho giai đoạn ${periodLabel}. Tin tức phải nằm trong giai đoạn này; phần giá lấy mốc cuối ngày ${toLabel}, hoặc official gần nhất nếu ngày cuối không có settlement.`;

  return `Bạn là Senior LME Base Metals Market Analyst cho desk giao dịch phái sinh hàng hóa tại Việt Nam.

NHIỆM VỤ
Tự dùng tìm kiếm web để tìm giá, tin tức và nguồn chính xác; sau đó viết báo cáo cho Đồng LME, Nhôm LME và Kẽm LME bằng tiếng Việt, ngắn gọn nhưng đủ chiều sâu, đi thẳng vào tác động giao dịch. Người đọc là trader, không giải thích khái niệm cơ bản.

PHẠM VI THỜI GIAN BẮT BUỘC
- ${priceRule}
- Không dùng tin sau ${toLabel}.
- Tin cũ chỉ được dùng làm bối cảnh và phải ghi rõ “bối cảnh trước đó”.
- Nếu cuối tuần hoặc không có settlement mới, ghi rõ “không có official LME settlement mới” và dùng giá official gần nhất làm mốc.
- Không bịa giá, tồn kho, phần trăm thay đổi, hỗ trợ/kháng cự hoặc nguồn tin.

NGUỒN ƯU TIÊN
LME, Westmetall, Reuters, Fed, BLS, EIA, ISM, NBS China, Caixin/RatingDog và SMM. Mọi số liệu và nhận định quan trọng phải có nguồn. Không đưa tin không có nguồn; nếu nguồn không chắc ghi “chưa xác nhận”; nếu không có dữ liệu official ghi “chưa có dữ liệu official”.

QUY TẮC PHÂN TÍCH CHUNG
- Mỗi phần “Giá như nào” phải ưu tiên đủ: Cash Settlement, giá 3M, phần trăm thay đổi so với phiên official trước, tồn kho LME và mức tăng/giảm tồn kho, chênh lệch Cash–3M và kết luận backwardation/contango.
- Nếu có nguồn intraday đáng tin cậy, nêu thêm mở/cao/thấp/đóng của phiên điện tử gần nhất, volume, open interest và giá tại thời điểm báo cáo. Luôn ghi rõ giờ của số intraday và trạng thái đã/chưa có official settlement mới.
- Nếu có gap, rút chân, phá hỗ trợ, test kháng cự, volume/open interest bất thường thì nêu rõ; chỉ ghi số khi có nguồn xác nhận.
- Tin vĩ mô cần xét: Fed, USD, lãi suất, NFP, CPI, PCE, PMI, JOLTS, ISM, ADP, GDP và jobless claims.
- Tin Trung Quốc cần xét: PMI, stimulus, bất động sản, hạ tầng, SHFE và spot.
- Mỗi tin phải trả lời: tin là gì, vì sao ảnh hưởng, tác động hỗ trợ hay gây áp lực.
- Nếu một kim loại không có tin riêng trọng yếu, ghi đúng câu: “Không có tin riêng trọng yếu; giá chủ yếu đi theo vĩ mô chung và kỹ thuật.”
- Độ chi tiết phải tương đương một bản morning note chuyên nghiệp: mỗi kim loại khoảng 450–700 từ khi có đủ dữ liệu, không rút gọn thành vài bullet chung chung.
- Số tiền/giá dùng cách viết nhất quán và luôn kèm USD/t hoặc tấn khi phù hợp; không đổi dấu thập phân nếu có nguy cơ làm sai số gốc.
- Link nguồn viết dạng Markdown [Tên nguồn ngắn](URL chuẩn). Không thêm utm_source=chatgpt.com hoặc tham số theo dõi do AI tự tạo.
- Không khuyến nghị mua hoặc bán trực tiếp.

FORMAT BẮT BUỘC
[TITLE]BÁO CÁO ĐỒNG LME NGÀY ${periodLabel}[/TITLE]

<b>Giá như nào:</b>
Viết 2 đoạn: đoạn đầu là official/cash/3M/tồn kho/cấu trúc kỳ hạn; đoạn hai là phiên điện tử, intraday và tín hiệu volume/OI/kỹ thuật nếu có.

<b>${newsSectionLabel}:</b>
Viết 2–4 đoạn theo mức độ quan trọng. Ưu tiên vĩ mô, Trung Quốc, tồn kho LME/SHFE, mỏ, đình công, smelter, warehouse, warrant/cancelled warrant, premium và tariff liên quan Đồng.

<b>Nhận xét:</b>
Đánh giá driver chính, driver phụ, phản ứng giá có hợp lý không, squeeze/backwardation thay đổi ra sao và tồn kho/kỹ thuật có xác nhận tin không.

<b>Đánh giá tin tức:</b> <b>[một mức: Tích cực / Trung tính tích cực / Trung tính / Trung tính tiêu cực / Tiêu cực].</b>
Nêu hỗ trợ gần, hỗ trợ sâu, kháng cự gần, kháng cự mạnh theo dạng: nếu vượt X → kiểm định Y; nếu mất A → rủi ro về B. Không có số chắc chắn thì ghi chưa có dữ liệu kỹ thuật xác nhận.

Nguồn tin:
1. [Tên nguồn – nội dung](https://...)

---

[TITLE]BÁO CÁO NHÔM LME NGÀY ${periodLabel}[/TITLE]

<b>Giá như nào:</b>
Viết 2 đoạn theo cấu trúc phần Đồng; chú ý thêm cash–3M, dầu/khí/điện, chi phí năng lượng, premium địa chính trị, Trung Đông/Trung Quốc, smelter, alumina/bauxite, tồn kho LME và billet nếu có.

<b>${newsSectionLabel}:</b>
Viết 2–4 đoạn theo thứ tự: vĩ mô chung, năng lượng/địa chính trị, ngành Nhôm, Trung Quốc/SHFE/spot. Giải thích hỗ trợ hay gây áp lực.

<b>Nhận xét:</b>
Đánh giá Nhôm mạnh/yếu hơn Đồng và Kẽm. Nếu giá giảm dù tồn kho giảm, giải thích bằng USD, premium chiến tranh, kỹ thuật hoặc demand.

<b>Đánh giá tin tức:</b> <b>[một mức].</b>
Nêu hỗ trợ gần, hỗ trợ sâu, kháng cự gần, kháng cự mạnh và hai kịch bản vượt/mất mốc như phần Đồng.

Nguồn tin:
1. [Tên nguồn – nội dung](https://...)

---

[TITLE]BÁO CÁO KẼM LME NGÀY ${periodLabel}[/TITLE]

<b>Giá như nào:</b>
Viết 2 đoạn theo cấu trúc phần Đồng; chú ý backwardation/contango, tồn kho LME/Trung Quốc, quặng kẽm, treatment charges, smelter output, thép mạ/xây dựng/sản xuất và spot Shanghai/Guangdong/Tianjin/Ningbo.

<b>${newsSectionLabel}:</b>
Viết 2–4 đoạn, phân biệt vĩ mô chung, tin riêng Kẽm, Trung Quốc/spot demand và tồn kho. Nếu Kẽm tăng nhưng spot demand yếu, ghi rõ mức tăng chưa được demand giao ngay xác nhận hoàn toàn.

<b>Nhận xét:</b>
Đánh giá Kẽm mạnh/yếu hơn Đồng và Nhôm, chỉ rõ driver chính và rủi ro nếu cấu trúc kỳ hạn/tồn kho đảo chiều.

<b>Đánh giá tin tức:</b> <b>[một mức].</b>
Nêu hỗ trợ gần, hỗ trợ sâu, kháng cự gần, kháng cự mạnh và hai kịch bản vượt/mất mốc như phần Đồng.

Nguồn tin:
1. [Tên nguồn – nội dung](https://...)

---
${includeEconomicCalendar ? `
[TITLE]CHỈ SỐ KINH TẾ ẢNH HƯỞNG ĐẾN LME NGÀY ${periodLabel}[/TITLE]
Nếu không có chỉ số lớn trong kỳ, ghi rõ ngày nào không có chỉ số kinh tế lớn trực tiếp ảnh hưởng LME, không tự bịa sự kiện để lấp chỗ trống.

Với từng chỉ số quan trọng trong kỳ, dùng format:
[TITLE][TÊN CHỈ SỐ][/TITLE]

<b>Chỉ số kinh tế:</b>
Nêu số thực tế, dự báo, kỳ trước; nếu chưa công bố ghi thời gian công bố theo giờ Việt Nam.

<b>Đánh giá tác động LME:</b>
Đánh giá qua USD/Fed, nhu cầu công nghiệp, năng lượng/lạm phát và Trung Quốc; nêu khác biệt với Đồng, Nhôm, Kẽm.

[TITLE]KẾT LUẬN NHANH CHO LME[/TITLE]
Tổng hợp các chỉ số đang hỗ trợ hay gây áp lực.

Nguồn link cho toàn bộ:
1. [Tên nguồn](https://...)

---` : 'Không thêm phần lịch/chỉ số kinh tế riêng; chỉ nhắc số liệu vĩ mô khi nó trực tiếp giải thích biến động kim loại.'}

[TITLE]TỔNG KẾT NHANH NGÀY ${periodLabel}[/TITLE]
Viết 3–5 câu thành một đoạn liền: kim loại khỏe nhất, yếu nhất, driver chính toàn nhóm LME, rủi ro phiên tới và sự kiện gần nhất cần theo dõi. Không khuyến nghị mua/bán trực tiếp.

QUY TẮC VIẾT CUỐI
- Giữ nguyên thẻ [TITLE]...[/TITLE] và nhãn <b>...</b>; không dùng markdown bold.
- Không viết lan man, không lặp tin giữa ba kim loại nếu không cần.
- Mỗi URL phải là nguồn đã thực sự tìm thấy, không tự tạo URL.
- Thứ tự bắt buộc: Đồng → Nhôm → Kẽm → Chỉ số kinh tế (nếu được chọn) → Tổng kết nhanh.
- Không bỏ các con số cấu trúc thị trường quan trọng chỉ để rút ngắn báo cáo. Nếu không tìm thấy thì ghi “chưa có dữ liệu official” thay vì suy đoán.
- Trước khi trả lời, tự kiểm tra toàn bộ mốc ngày và loại bỏ mọi tin nằm ngoài kỳ.`;
}

export function buildLatestReutersPrompt(now: Date): string {
  const timestamp = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now);

  return `Bạn là Senior LME Base Metals Market Analyst. Thời điểm quét: ${timestamp} (giờ Việt Nam).

NHIỆM VỤ TỐC ĐỘ CAO
- Dùng tìm kiếm web ngay bây giờ để tìm các tin Reuters mới nhất có ảnh hưởng thực sự đến Đồng LME, Nhôm LME hoặc Kẽm LME.
- Ưu tiên tin xuất bản gần hiện tại nhất; chỉ xét 72 giờ gần nhất và nêu rõ thời gian Reuters đăng.
- Tối đa 3 truy vấn tìm kiếm, dừng khi đã có các tin Reuters trọng yếu nhất. Không kéo dài vì tin thứ yếu.
- Nguồn chính bắt buộc là URL thuộc reuters.com. Có thể dùng LME hoặc cơ quan chính thức chỉ để kiểm tra số liệu, nhưng không thay Reuters bằng blog hoặc trang tổng hợp.
- Có thể dùng Reuters cũ hơn 72 giờ chỉ làm “bối cảnh trước đó” cho một tin mới và phải gắn nhãn rõ; không dùng tin cũ thay cho kết quả quét mới.
- Không bịa headline, thời gian, giá, tồn kho hay URL. Nếu không tìm thấy Reuters mới phù hợp, ghi đúng: “Chưa tìm thấy tin Reuters mới trong 72 giờ qua có tác động trực tiếp và đủ nguồn xác nhận.”
- Tổng hợp 4–7 driver thực sự quan trọng. Mỗi driver phải có ít nhất một link Reuters đã tìm thấy; không lặp cùng một sự kiện thành nhiều mục.
- Đánh giá Đồng, Nhôm, Kẽm theo xu hướng ngắn hạn và giải thích khác biệt giữa ba kim loại bằng dữ liệu nguồn cung, tồn kho, USD/Fed, Trung Quốc, năng lượng hoặc logistics.
- Không khuyến nghị mua/bán trực tiếp.

FORMAT BẮT BUỘC — KHÔNG DÙNG THẺ [TITLE]
Mở đầu bằng đúng một đoạn tổng quan theo kiểu:
“Tính đến [giờ/ngày Việt Nam], tin Reuters đang tạo ra [đánh giá chung], nhưng [kim loại mạnh nhất], [kim loại biến động nhất], còn [kim loại yếu nhất].”

Ngay sau đó xuất Markdown table đúng 3 cột:
| Kim loại LME | Đánh giá ngắn hạn | Động lực chính |
| --- | --- | --- |
| Nhôm | ... | ... |
| Đồng | ... | ... |
| Kẽm | ... | ... |
Sắp xếp ba dòng theo mức độ đáng chú ý tại thời điểm quét, không cố định thứ tự nếu dữ liệu cho kết luận khác.

Sau bảng, viết các mục đánh số:
1. [Tiêu đề driver quan trọng nhất]

[Một hoặc hai đoạn tóm tắt sự kiện, số liệu then chốt, mốc thời gian và vì sao thị trường quan tâm]. Cuối đoạn đặt link theo dạng: Reuters: [Tên bài ngắn](URL Reuters chuẩn)

Tác động:

Nhôm: [tác động và cơ chế truyền dẫn cụ thể].
Đồng: [tác động và cơ chế truyền dẫn cụ thể].
Kẽm: [tác động và cơ chế truyền dẫn cụ thể].

Lặp cấu trúc trên cho 4–7 driver. Nếu một driver chỉ liên quan một hoặc hai kim loại, chỉ cần viết những kim loại thực sự bị ảnh hưởng.

Kết thúc bằng tiêu đề văn bản “Kết luận giao dịch theo tin Reuters”, sau đó viết riêng ba dòng Nhôm, Đồng, Kẽm: xu hướng quan sát, lý do chính và rủi ro đảo chiều. Đoạn cuối nêu sự kiện có giờ Việt Nam gần nhất cần theo dõi.

QUY TẮC TRÌNH BÀY
- Không dùng [TITLE], không dùng bảng HTML, không dùng code block.
- Link nguồn dùng Markdown [Tên bài](URL), ưu tiên canonical Reuters URL và không thêm utm_source=chatgpt.com.
- Bản tin phải đủ chiều sâu như mẫu desk: khoảng 900–1.500 từ khi có đủ 4–7 tin, nhưng ưu tiên tốc độ và chỉ giữ tin có tác động giao dịch rõ.
- Không bịa headline, URL, giờ công bố, giá, tồn kho, công suất hoặc tỷ lệ. Mọi số cụ thể phải truy nguyên được từ nguồn đã tìm thấy.`;
}

function timeRangeForDates(fromDate: string, toDate: string) {
  return {
    startTime: `${fromDate}T00:00:00+07:00`,
    endTime: `${nextIsoDay(toDate)}T00:00:00+07:00`,
  };
}

function extractUrls(text: string): GroundedSource[] {
  const urls = text.match(/https?:\/\/[^\s<>\])]+/g) || [];
  return urls.map((uri) => {
    const cleanUri = uri.replace(/[.,;:]+$/, '');
    try {
      return { title: new URL(cleanUri).hostname.replace(/^www\./, ''), uri: cleanUri };
    } catch {
      return { title: 'Nguồn', uri: cleanUri };
    }
  });
}

function uniqueSources(sources: GroundedSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.uri.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorForGemini(code: number, message: string, model: string) {
  if (code === 429) return new Error('Gemini đã hết quota tìm kiếm tạm thời. Hãy đợi một lúc rồi thử lại.');
  if (code === 401 || code === 403) return new Error('Gemini API Key không hợp lệ hoặc chưa được cấp quyền Google Search grounding.');
  if (code === 404) return new Error(`Model “${model}” không khả dụng. Hãy đổi model trong phần Đọc ảnh → Cấu hình AI.`);
  return new Error(`Gemini lỗi ${code}: ${message || 'Không thể tạo báo cáo tin tức.'}`);
}

async function callGroundedGemini(
  prompt: string,
  timeRange: { startTime: string; endTime: string },
  maxOutputTokens: number,
  timeoutMs: number,
): Promise<GroundedNewsResult> {
  const settings = loadLocalAiSettings();
  const apiKey = settings.geminiApiKey.trim();
  const model = settings.model.trim();
  if (!apiKey || !model) {
    throw new Error('Chưa có Gemini API Key. Vào Đọc ảnh → Cấu hình AI để nhập và lưu khóa trên trình duyệt này.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const request = async (useTimeFilter: boolean) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const googleSearch = useTimeFilter
        ? { timeRangeFilter: { startTime: timeRange.startTime, endTime: timeRange.endTime } }
        : {};
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: googleSearch }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens,
          },
        }),
      });
      let payload: GeminiPayload;
      try {
        payload = await response.json() as GeminiPayload;
      } catch {
        payload = { error: { code: response.status, message: 'Phản hồi API không hợp lệ.' } };
      }
      return { response, payload, useTimeFilter };
    } finally {
      window.clearTimeout(timer);
    }
  };

  let result;
  try {
    result = await request(true);
    const firstMessage = result.payload.error?.message || '';
    if (result.response.status === 400 && /time.?range|start.?time|end.?time|google.?search/i.test(firstMessage)) {
      result = await request(false);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tìm kiếm mất quá nhiều thời gian. Hãy thu hẹp khoảng ngày hoặc thử lại.');
    }
    throw error;
  }

  if (!result.response.ok || result.payload.error) {
    const code = result.payload.error?.code || result.response.status;
    throw errorForGemini(code, result.payload.error?.message || '', model);
  }

  const candidate = result.payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!text) throw new Error('Gemini trả về báo cáo rỗng. Hãy thử lại.');

  const metadata = candidate?.groundingMetadata;
  const groundedSources = (metadata?.groundingChunks || [])
    .map((chunk) => ({
      title: chunk.web?.title?.trim() || 'Nguồn tìm kiếm',
      uri: chunk.web?.uri?.trim() || '',
    }))
    .filter((source) => source.uri);
  const sources = uniqueSources([...extractUrls(text), ...groundedSources]);
  const queries = [...new Set((metadata?.webSearchQueries || []).filter(Boolean))];
  if (!sources.length && !queries.length) {
    throw new Error(`Model “${model}” không trả dữ liệu Google Search grounding. Hãy chọn model có hỗ trợ Google Search rồi thử lại.`);
  }

  return {
    text,
    sources,
    queries,
    generatedAt: new Date().toISOString(),
    searchEntryPointHtml: metadata?.searchEntryPoint?.renderedContent || '',
    usedTimeFilter: result.useTimeFilter,
  };
}

async function callGroundedAi(
  prompt: string,
  timeRange: { startTime: string; endTime: string },
  maxOutputTokens: number,
  timeoutMs: number,
  maxToolCalls: number,
) {
  const settings = loadLocalAiSettings();
  if (settings.provider === 'openai') {
    return callConfiguredOpenAiSearch(prompt, maxOutputTokens, timeoutMs, maxToolCalls);
  }
  return callGroundedGemini(prompt, timeRange, maxOutputTokens, timeoutMs);
}

export async function generateDailyNewsReport(
  fromDate: string,
  toDate: string,
  includeEconomicCalendar: boolean,
) {
  const validationError = validateNewsDateRange(fromDate, toDate);
  if (validationError) throw new Error(validationError);
  return callGroundedAi(
    buildDailyNewsPrompt(fromDate, toDate, includeEconomicCalendar),
    timeRangeForDates(fromDate, toDate),
    24_576,
    120_000,
    10,
  );
}

export async function generateLatestReutersUpdate(now = new Date()) {
  const start = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 5 * 60 * 1000);
  const result = await callGroundedAi(
    buildLatestReutersPrompt(now),
    { startTime: start.toISOString(), endTime: end.toISOString() },
    8_192,
    60_000,
    3,
  );
  const reutersSources = result.sources.filter((source) => /reuters/i.test(`${source.title} ${source.uri}`));
  if (reutersSources.length) return { ...result, sources: reutersSources };
  if (/chưa tìm thấy tin reuters mới/i.test(result.text)) return result;
  throw new Error('AI chưa trả được nguồn Reuters xác nhận. Hãy bấm cập nhật lại sau ít phút.');
}
