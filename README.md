# Khoot Mini

Khoot Mini là trò chơi trắc nghiệm realtime cho số lượng học sinh tùy chọn và 1 máy quản trị, sử dụng Supabase Auth, PostgreSQL và Realtime Broadcast.

## Tính năng

- Đăng nhập và đăng xuất bằng tài khoản quản trị được tạo trực tiếp trong Supabase.
- Mỗi tài khoản chỉ quản lý dữ liệu của chính mình nhờ chính sách bảo mật theo từng hàng.
- Tạo, sửa, xóa và xuất bản bộ đề thuộc bất kỳ lĩnh vực nào.
- Sắp xếp bộ đề trong cây thư mục nhiều cấp; hỗ trợ kéo/thả, đổi thư mục đích và thay đổi thứ tự.
- Nhập nhanh cả bộ đề từ danh sách câu hỏi dạng văn bản.
- Mỗi câu hỏi gồm nội dung hoặc định nghĩa, đúng 4 lựa chọn và 1 đáp án chính xác.
- Người quản trị nhập số học sinh, mở phòng và gửi liên kết riêng.
- Mỗi tài khoản quản trị có một link phòng cố định dùng chung cho cả quản trị viên và học sinh.
- Mỗi lần mở bộ đề tạo một phiên chơi mới bên trong phòng cố định, nên điểm và thống kê giữa các lần chơi không bị trộn.
- Học sinh nhập tên, bấm sẵn sàng và trả lời đồng thời trên các máy khác nhau.
- Đếm ngược 3–2–1, giới hạn thời gian theo từng bộ đề và tự động chuyển câu.
- Chấm điểm theo đáp án đúng và tốc độ trả lời.
- Hiển thị bảng xếp hạng cùng thống kê số câu đúng và thời gian phản hồi trung bình.
- Tự động triển khai lên GitHub Pages khi có thay đổi trên nhánh `main`.

## Chạy trên máy

Yêu cầu Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Sao chép `.env.example` thành `.env.local` nếu muốn dùng cấu hình Supabase khác. URL và publishable key có thể xuất hiện trong mã trình duyệt; quyền truy cập dữ liệu được bảo vệ bằng chính sách của cơ sở dữ liệu.

## Cơ sở dữ liệu

Các migration nằm trong thư mục:

```text
supabase/migrations
```

Áp dụng migration sau khi đã đăng nhập và liên kết dự án Supabase:

```bash
npx supabase db push --linked
```

Migration tạo ngân hàng câu hỏi, phòng chơi, người chơi, bản chụp câu hỏi và câu trả lời. Các thao tác của học sinh đi qua hàm cơ sở dữ liệu có kiểm soát; đáp án đúng chỉ được trả về sau khi hết câu.

## Tạo bản phát hành

```bash
npm run build:pages
```

GitHub Actions tạo bản xuất tĩnh trong thư mục `out` và triển khai lên GitHub Pages.
