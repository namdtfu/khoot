-- Các policy quản trị trong migration 007 gọi is_admin() khi chạy dưới
-- vai trò authenticated. Hàm chỉ kiểm tra auth.uid() hiện tại nên có thể
-- cấp quyền thực thi an toàn mà không làm lộ dữ liệu hay cho phép đổi role.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
