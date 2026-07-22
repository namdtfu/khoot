# Khoot Mini

Khoot Mini là trò chơi trắc nghiệm dành cho nhóm 5 người, kèm trang quản trị bộ đề sử dụng Supabase Auth và PostgreSQL.

## Tính năng

- Đăng ký, đăng nhập và đăng xuất bằng địa chỉ email và mật khẩu.
- Mỗi tài khoản chỉ quản lý dữ liệu của chính mình nhờ chính sách bảo mật theo từng hàng.
- Tạo, sửa, xóa và xuất bản bộ đề thuộc bất kỳ lĩnh vực nào.
- Mỗi câu hỏi gồm nội dung hoặc định nghĩa, đúng 4 lựa chọn và 1 đáp án chính xác.
- Chơi thử theo lượt với 5 người và bảng xếp hạng điểm.
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

Migration tạo hai bảng `question_sets` và `questions`, chỉ mục, trigger cập nhật thời gian và chính sách truy cập theo chủ sở hữu.

## Tạo bản phát hành

```bash
npm run build:pages
```

GitHub Actions tạo bản xuất tĩnh trong thư mục `out` và triển khai lên GitHub Pages.
