# Saymee Live STT

Saymee Live STT là tiện ích Chrome Manifest V3 chép lời theo thời gian thực từ âm thanh của tab trình duyệt, microphone hoặc đồng thời cả hai nguồn.

**Phát triển:** Long Ngo  
**Giấy phép:** MIT  
**Kho mã nguồn:** [Base27-CVNSS/saymee](https://github.com/Base27-CVNSS/saymee)

## Saymee làm được gì?

- Chép lời trực tiếp âm thanh đang phát trong tab YouTube, Google Meet, Zoom Web, Microsoft Teams Web và các trang HTTP/HTTPS.
- Nhận giọng nói từ microphone.
- Chạy song song âm thanh tab và microphone bằng hai pipeline độc lập.
- Nhận dạng qua Deepgram Streaming STT với model `nova-3`.
- Dùng Chrome Speech cho microphone khi không muốn cấu hình Deepgram.
- Hiển thị transcript tạm thời và transcript hoàn chỉnh theo thời gian thực.
- Hiển thị nguồn `TAB`/`MIC`, thời gian, người nói và độ tin cậy khi dịch vụ có cung cấp.
- Đếm số đoạn, số từ và thời lượng phiên.
- Sao chép transcript hoặc xuất tệp TXT UTF-8.
- Hiển thị mức âm lượng riêng cho tab và microphone.
- Chẩn đoán từng tầng: quyền tab, MediaStream, AudioContext, AudioWorklet, PCM, token, WebSocket và transcript.
- Tự kết nối lại Deepgram tối đa ba lần khi mạng gián đoạn.
- Dừng và giải phóng MediaStream, AudioContext, AudioWorklet và WebSocket khi kết thúc phiên.

## Ứng dụng của STT Saymee

| Nhu cầu | Cách sử dụng Saymee |
|---|---|
| Họp trực tuyến | Chép lời Google Meet, Zoom Web hoặc Teams Web để tạo biên bản nháp |
| Bài giảng và hội thảo | Ghi lại nội dung bài giảng, webinar hoặc livestream |
| Phỏng vấn và nghiên cứu | Chép lời cuộc phỏng vấn từ tab và ghi câu hỏi qua microphone |
| Sản xuất nội dung | Tạo bản thô cho phụ đề video, podcast và nội dung mạng xã hội |
| Ghi chú cá nhân | Chuyển giọng nói từ microphone thành văn bản tức thời |
| Hỗ trợ tiếp cận | Hiển thị chữ trực tiếp cho người cần theo dõi nội dung bằng văn bản |
| Chăm sóc khách hàng | Tạo transcript nháp cho cuộc gọi chạy trong ứng dụng web |
| Theo dõi truyền thông | Thu lời nói từ nguồn phát trên web để tìm kiếm và tổng hợp sau phiên |

Saymee tạo transcript hỗ trợ công việc. Với hồ sơ pháp lý, y tế, tài chính hoặc nội dung cần độ chính xác tuyệt đối, người dùng phải nghe lại và hiệu đính.

## Kiến trúc chuẩn

Cấu hình cài mới mặc định:

```js
{
  engine: 'deepgram',
  source: 'tab',
  tabCaptureMode: 'active_tab',
  language: 'vi',
  model: 'nova-3'
}
```

Bốn nguyên tắc ổn định:

1. Deepgram + Tab + `activeTab` là đường hoạt động chính.
2. Chrome Speech là chế độ phụ và chỉ dùng microphone.
3. Saymee không tự đổi engine hoặc nguồn âm thanh khi xảy ra lỗi.
4. Đổi engine không làm mất hồ sơ Deepgram đã chọn; bản nâng cấp vẫn đọc được khóa cấu hình Saydi cũ.

### Luồng Deepgram

```text
Tab hiện tại hoặc microphone
→ MediaStream
→ AudioContext
→ AudioWorklet
→ PCM16 mono 16 kHz
→ Deepgram Streaming WebSocket
→ transcript thời gian thực
```

### Luồng Chrome Speech

```text
Microphone
→ Web Speech Recognition của Chrome
→ transcript thời gian thực
```

Chrome Speech không dùng `tabCapture`, AudioWorklet, Deepgram hoặc token server.

## Yêu cầu

- Google Chrome hoặc trình duyệt Chromium tương thích Manifest V3.
- Chrome 116 trở lên.
- Node.js 18 trở lên nếu dùng token server mẫu.
- Tài khoản Deepgram nếu dùng Deepgram.
- Trang web HTTP/HTTPS nếu muốn capture âm thanh tab.

Chrome không cho extension capture trực tiếp các trang như `chrome://`, Chrome Web Store, trang cài đặt, trang tab mới và một số trang hệ thống.

## Cài đặt

### Cách 1: tải mã nguồn từ GitHub

1. Mở [Base27-CVNSS/saymee](https://github.com/Base27-CVNSS/saymee).
2. Chọn **Code → Download ZIP**.
3. Giải nén ZIP.
4. Mở `chrome://extensions`.
5. Bật **Chế độ dành cho nhà phát triển**.
6. Chọn **Tải tiện ích đã giải nén**.
7. Chọn thư mục có tệp `manifest.json`.
8. Ghim **Saymee Live STT** lên thanh công cụ.

### Cách 2: cập nhật bản đã cài bằng Load unpacked

Để giữ extension ID, quyền microphone và cấu hình:

1. Dừng phiên Saymee đang chạy.
2. Chép mã mới đè vào đúng thư mục Chrome đang tải.
3. Mở `chrome://extensions`.
4. Bấm **Tải lại** trên thẻ Saymee.
5. Đóng rồi mở lại side panel.

Nếu tải mã từ một thư mục mới, Chrome có thể tạo extension ID khác; khi đó quyền và `chrome.storage` cũ không được dùng chung.

## Cách dùng nhanh

### Chép lời tab hiện tại bằng Deepgram

Đây là chế độ mặc định.

1. Mở tab đang phát âm thanh.
2. Bấm biểu tượng **Saymee Live STT** trên chính tab đó.
3. Giữ **Deepgram → Tab hiện tại → Tab hiện tại — activeTab**.
4. Cấu hình temporary token hoặc API key.
5. Bấm **Bắt đầu nhận dạng**.
6. Theo dõi thanh âm lượng `TAB` và transcript trực tiếp.
7. Bấm **Dừng phiên** khi hoàn tất.

Quyền `activeTab` là quyền tạm thời. Nếu bạn chuyển tab hoặc điều hướng sang website khác, hãy bấm lại biểu tượng Saymee trên tab cần ghi.

### Chép lời bằng hộp chọn tab của Chrome

Dùng cách này khi `activeTab` hết hiệu lực hoặc cần chọn một tab khác:

1. Chọn **Deepgram**.
2. Chọn nguồn **Tab hiện tại** hoặc **Tab + Microphone**.
3. Chọn **Hộp chọn tab của Chrome — phương án dự phòng**.
4. Bấm **Bắt đầu nhận dạng**.
5. Chọn đúng tab trong hộp thoại Chrome.
6. Bật **Chia sẻ âm thanh tab** rồi xác nhận.

Desktop Capture chỉ thay cách lấy MediaStream; engine vẫn là Deepgram.

### Chép lời microphone bằng Chrome Speech

1. Bấm biểu tượng Saymee.
2. Chọn **Chrome Speech — microphone, không cần API**.
3. Bấm **Cấp quyền microphone**.
4. Trong trang quyền, chọn **Cho phép** rồi đóng trang.
5. Bấm **Bắt đầu nhận dạng**.

Chế độ này phụ thuộc Web Speech Recognition, chính sách Chrome và kết nối mạng. Một số bản dựng Chromium hoặc môi trường doanh nghiệp có thể tắt dịch vụ này.

### Chép lời tab và microphone đồng thời

1. Chọn **Deepgram**.
2. Chọn **Tab + Microphone**.
3. Chọn cách capture tab.
4. Cấp quyền microphone.
5. Kiểm tra kết nối Deepgram.
6. Bấm **Bắt đầu nhận dạng**.

Tab và microphone là hai pipeline riêng. Transcript hiển thị nhãn nguồn để phân biệt.

## Cấu hình Deepgram

### Temporary token — khuyến nghị

Không nhúng API key Deepgram dài hạn vào extension hoặc kho Git công khai. Thư mục `server` cung cấp token broker mẫu cho phát triển cục bộ.

#### Windows PowerShell

```powershell
cd server
$env:DEEPGRAM_API_KEY="YOUR_DEEPGRAM_API_KEY"
npm start
```

#### macOS hoặc Linux

```bash
cd server
DEEPGRAM_API_KEY="YOUR_DEEPGRAM_API_KEY" npm start
```

Token endpoint mặc định:

```text
http://127.0.0.1:8787/token
```

Health check:

```text
http://127.0.0.1:8787/health
```

Trong Saymee:

1. Mở **Thiết lập kết nối Deepgram**.
2. Chọn **Temporary token — khuyến nghị**.
3. Nhập `http://127.0.0.1:8787/token`.
4. Bấm **Kiểm tra**.
5. Khi trạng thái báo hợp lệ, bắt đầu nhận dạng.

Máy chủ mẫu yêu cầu Deepgram hỗ trợ endpoint cấp temporary token cho tài khoản/API key đang dùng. Trong production, cần HTTPS, xác thực người dùng, giới hạn tần suất, quota và chính sách CORS phù hợp.

### API key trực tiếp — chỉ thử nghiệm cục bộ

1. Mở **Thiết lập kết nối Deepgram**.
2. Chọn **API key — chỉ dùng cục bộ**.
3. Dán API key.
4. Chỉ bật **Lưu API key trên máy này** nếu chấp nhận lưu key trong `chrome.storage.local`.

Nếu không bật lưu, Saymee đặt key trong `chrome.storage.session`; key mất khi phiên trình duyệt kết thúc.

Không:

- ghi API key vào mã nguồn;
- commit `.env`;
- đóng gói key trong ZIP phát hành;
- chụp hoặc chia sẻ màn hình có key;
- đưa key vào báo cáo chẩn đoán.

## Làm việc với transcript

- **Sao chép:** đưa toàn bộ transcript hoàn chỉnh vào clipboard.
- **Xuất TXT:** tạo tệp UTF-8 có BOM để mở đúng tiếng Việt trên Windows.
- **Xóa:** xóa transcript của phiên hiện tại khỏi giao diện và runtime.
- **Nhãn nguồn:** `TAB` là âm thanh tab; `MIC` là microphone.
- **Người nói:** hiển thị khi Deepgram trả thông tin diarization.

Saymee không tự lưu audio và không có cơ sở dữ liệu transcript. Hãy sao chép hoặc xuất TXT trước khi đóng nếu cần giữ nội dung.

## Quyền của extension

| Quyền | Mục đích |
|---|---|
| `activeTab` | Cho phép thao tác với tab vừa được người dùng kích hoạt Saymee |
| `tabCapture` | Lấy âm thanh trực tiếp từ tab hiện tại |
| `desktopCapture` | Mở hộp chọn tab dự phòng của Chrome |
| `offscreen` | Duy trì MediaStream, AudioContext và WebSocket ngoài side panel |
| `sidePanel` | Hiển thị giao diện Saymee |
| `storage` | Lưu cấu hình người dùng |
| `https://api.deepgram.com/*` | Kết nối dịch vụ Deepgram |
| `localhost` / `127.0.0.1` | Kết nối token server cục bộ |

Token endpoint HTTPS từ xa được xin quyền theo origin khi người dùng chủ động cấu hình.

## Quyền riêng tư và bảo mật

- Saymee chỉ bắt đầu thu khi người dùng bấm **Bắt đầu nhận dạng**.
- Khi dùng Deepgram, audio được gửi trực tiếp tới Deepgram để nhận dạng.
- Khi dùng Chrome Speech, audio được xử lý theo cơ chế Web Speech của trình duyệt và có thể sử dụng dịch vụ trực tuyến của Chrome.
- Token server mẫu chỉ cấp thông tin xác thực; nó không nhận audio từ Saymee.
- Nhật ký kỹ thuật không chứa API key, temporary token hoặc nội dung xác thực.
- Bấm **Dừng phiên** sẽ đóng audio track, AudioContext và WebSocket.
- Không có API key hoặc token nào được đóng gói sẵn trong kho mã nguồn.

Trước khi ghi âm cuộc họp hoặc người khác, người dùng phải tuân thủ quy định về thông báo, đồng ý ghi âm, dữ liệu cá nhân và chính sách của tổ chức.

## Chẩn đoán và xử lý sự cố

### “Extension chưa được kích hoạt trên tab”

- Đưa đúng tab cần ghi lên trước.
- Bấm biểu tượng Saymee trên chính tab đó.
- Hoặc chọn **Hộp chọn tab của Chrome**.

### Không có âm thanh tab

- Bảo đảm tab đang thực sự phát âm thanh.
- Với hộp chọn Chrome, chọn đúng tab và bật **Chia sẻ âm thanh tab**.
- Không thử capture trang `chrome://` hoặc Chrome Web Store.
- Mở **Chẩn đoán kỹ thuật** để kiểm tra MediaStream và AudioContext.

### Token server không phản hồi

- Bảo đảm `npm start` vẫn đang chạy.
- Mở `http://127.0.0.1:8787/health`.
- Kiểm tra biến môi trường `DEEPGRAM_API_KEY`.
- Kiểm tra đúng địa chỉ token endpoint.
- Với endpoint từ xa, dùng HTTPS.

### Deepgram từ chối kết nối

- Kiểm tra API key hoặc temporary token.
- Kiểm tra hạn mức và trạng thái tài khoản Deepgram.
- Kiểm tra mạng, proxy và firewall.
- Bấm **Kiểm tra** trước khi bắt đầu phiên.

### Microphone đã cấp quyền nhưng không có chữ

- Kiểm tra thiết bị microphone mặc định của Chrome và hệ điều hành.
- Nói gần mic và xem thanh mức âm lượng có di chuyển không.
- Tải lại extension sau khi cập nhật mã.
- Nếu Chrome Speech bị chặn, thử Deepgram + Microphone.

### Ứng dụng vẫn không bắt đầu

1. Mở **Chẩn đoán kỹ thuật**.
2. Bấm **Kiểm tra lại API**.
3. Bắt đầu một phiên.
4. Tìm tầng đầu tiên chuyển sang lỗi.
5. Bấm **Sao chép nhật ký** để lấy báo cáo an toàn.

Thứ tự pipeline Deepgram:

```text
MediaStream → AudioContext → AudioWorklet/PCM → Xác thực → WebSocket → Transcript
```

## Cấu trúc dự án

```text
.
├── manifest.json
├── background.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── offscreen.html
├── offscreen.js
├── audio-worklet.js
├── permission.html
├── permission.js
├── icons/
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── server/
│   ├── package.json
│   └── token-server.mjs
├── tests/
│   └── smoke.mjs
└── LICENSE
```

### Vai trò các mô-đun

- `background.js`: mở side panel, kiểm tra tab, lấy stream ID, tạo offscreen document và điều phối lệnh.
- `sidepanel.*`: giao diện, cấu hình, trạng thái nguồn, transcript và chẩn đoán.
- `offscreen.js`: sở hữu phiên STT, MediaStream, AudioContext, WebSocket và Chrome Speech.
- `audio-worklet.js`: chuyển audio thành PCM16 mono 16 kHz cho Deepgram.
- `permission.*`: trang cấp quyền microphone từ extension origin.
- `server/token-server.mjs`: token broker Deepgram mẫu.
- `tests/smoke.mjs`: kiểm tra manifest và các hợp đồng kiến trúc quan trọng.

## Phát triển và kiểm thử

Kiểm tra cú pháp:

```bash
node --check background.js
node --check sidepanel.js
node --check offscreen.js
node --check audio-worklet.js
node --check permission.js
node --check server/token-server.mjs
```

Chạy smoke test:

```bash
node tests/smoke.mjs
```

Trước khi phát hành, cần kiểm tra thực tế:

- YouTube bằng `activeTab`;
- YouTube bằng Desktop Capture;
- tab không bật chia sẻ âm thanh;
- tab bị đóng khi đang ghi;
- microphone bị từ chối quyền;
- Chrome Speech không có tiếng nói;
- token server không chạy;
- token sai hoặc hết hạn;
- mất mạng và kết nối lại;
- Start/Stop nhiều lần;
- chạy liên tục ít nhất 30 phút;
- nâng cấp từ Saydi mà không mất cấu hình.

Smoke test không thay thế kiểm thử end-to-end trong Chrome.

## Tương thích cấu hình Saydi

Saymee dùng khóa mới:

```text
saymeeLiveSettings
saymeeSessionApiKey
```

Khi khởi động, Saymee vẫn đọc:

```text
saydiLiveSettings
saydiSessionApiKey
```

Nếu tìm thấy cấu hình cũ mà chưa có cấu hình mới, Saymee migration sang khóa mới và không xóa khóa cũ. Cách này giúp nâng cấp an toàn và vẫn cho phép quay lại bản cũ khi cần.

## Giới hạn hiện tại

- Saymee chỉ tập trung vào STT; chưa dịch máy, tóm tắt hoặc lưu audio.
- Độ chính xác phụ thuộc chất lượng âm thanh, ngôn ngữ, người nói, mạng và engine.
- Chrome Speech không khả dụng đồng nhất trên mọi trình duyệt Chromium.
- Deepgram cần tài khoản, xác thực và hạn mức sử dụng.
- Trang nội bộ của Chrome không thể capture.

## Giấy phép

Dự án được phát hành theo giấy phép [MIT](LICENSE).

```text
Copyright (c) 2026 Long Ngo
```

Bạn được phép sử dụng, sao chép, sửa đổi, phân phối và thương mại hóa theo các điều kiện của giấy phép MIT.
