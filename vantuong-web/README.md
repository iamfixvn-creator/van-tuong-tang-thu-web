# Tra cứu tàng thư Vạn Tường — bản web dùng chung

Bản này chuyển phần lưu hồ sơ/tài khoản từ IndexedDB/localStorage trên từng trình duyệt sang máy chủ Express + SQLite. Các máy đăng nhập cùng website sẽ dùng chung dữ liệu.

## Chức năng đã nối máy chủ
- Đăng nhập và phiên làm việc lưu ở máy chủ; cookie HttpOnly, Secure khi chạy production, SameSite Strict.
- Mật khẩu lưu bằng bcrypt; giới hạn thử đăng nhập.
- Quyền admin / receiver / processor / viewer được kiểm tra tại API.
- Hồ sơ và ảnh (đang nén thành data URL trong giao diện gốc) được lưu tập trung trong SQLite.
- Quản lý tài khoản, đổi mật khẩu, xuất/nhập JSON và CSV.
- SQLite và session database được đặt dưới `DATA_DIR` để có thể gắn persistent disk.

## Chạy thử trên máy cá nhân
Yêu cầu Node.js 20 trở lên.

1. Sao chép `.env.example` thành `.env`.
2. Đặt `SESSION_SECRET` thành chuỗi ngẫu nhiên dài ít nhất 32 ký tự.
3. Đặt `INITIAL_ADMIN_PASSWORD` thành mật khẩu ngẫu nhiên riêng, tối thiểu 14 ký tự. Không dùng `admin123`.
4. Chạy:

```bash
npm install
npm start
```

5. Mở `http://localhost:3000`, đăng nhập `admin` bằng mật khẩu đã đặt trong `.env`.
6. Đổi mật khẩu admin, tạo 3–5 tài khoản riêng. Mật khẩu tài khoản mới tối thiểu 12 ký tự.

Không gửi `.env`, mật khẩu, file SQLite hoặc bản sao lưu có dữ liệu thật lên GitHub.

## Triển khai bản thử nghiệm lên Render
Render cần Web Service và persistent disk vì SQLite phải giữ dữ liệu sau khi restart/deploy. Bản cấu hình `render.yaml` đã đặt:
- Region Singapore.
- Node Web Service, Starter.
- Persistent disk 1 GB tại `/var/data`.
- `SESSION_SECRET` được Render sinh tự động.
- `INITIAL_ADMIN_PASSWORD` cần nhập thủ công.

Các bước:
1. Tạo repository GitHub **Private** mới.
2. Upload toàn bộ nội dung thư mục này lên repository. Không upload `.env`, `data/`, `node_modules/` hoặc bản backup thật.
3. Trên Render, chọn **New → Blueprint**, kết nối GitHub và chọn repository.
4. Render đọc `render.yaml`; khi được hỏi, nhập `INITIAL_ADMIN_PASSWORD` là mật khẩu mạnh, ngẫu nhiên, tối thiểu 14 ký tự.
5. Xác nhận tạo dịch vụ. Chờ deploy thành công rồi mở URL `https://...onrender.com` do Render cấp.
6. Đăng nhập bằng username `admin` và mật khẩu khởi tạo. Đổi mật khẩu ngay, sau đó tạo tài khoản cá nhân cho từng cán bộ.
7. Kiểm tra bằng hai thiết bị/trình duyệt khác nhau: tạo hồ sơ bằng tài khoản được phép và xác nhận thiết bị còn lại thấy dữ liệu.

## Chuyển dữ liệu cũ
Từ bản HTML cũ, đăng nhập trên đúng máy/trình duyệt đang giữ dữ liệu, vào **Sao lưu → Xuất sao lưu đầy đủ (.JSON)**. Sau khi website mới hoạt động, đăng nhập tài khoản admin trên website mới và dùng **Sao lưu → Nhập khôi phục từ tệp (.JSON)**. Kiểm tra số lượng hồ sơ, ảnh và ngày tháng trước khi sử dụng.

Lưu ý: file HTML cũ có thể giữ dữ liệu riêng trên từng máy. Hãy xuất backup từ từng thiết bị có dữ liệu cần giữ và hợp nhất cẩn thận; đừng nhập các bản trùng lặp nếu chưa đối soát.

## Trước khi dùng dữ liệu cá nhân thật
Đây là bản triển khai thử nghiệm, chưa phải chứng nhận an toàn thông tin hay xác nhận tuân thủ quy định dữ liệu cá nhân/cơ quan nhà nước. Dữ liệu có thể được lưu ngoài Việt Nam nếu dùng region Singapore. Chỉ nhập dữ liệu thật sau khi đơn vị có thẩm quyền phê duyệt nhà cung cấp, vị trí lưu trữ, quyền truy cập, thời hạn lưu, sao lưu/khôi phục, nhật ký truy cập và phương án ứng phó sự cố. Cần kiểm thử bảo mật độc lập trước khi vận hành chính thức.

## Lưu ý vận hành
- Bật MFA cho tài khoản GitHub/Render.
- Giữ repository private; chỉ cấp quyền cho người triển khai.
- Sao lưu SQLite định kỳ và lưu bản sao ở nơi tách biệt, có mã hóa; kiểm thử khôi phục.
- Không dùng chung tài khoản giữa cán bộ.
- Khi cán bộ nghỉ/đổi nhiệm vụ, admin phải thu hồi tài khoản ngay.
- Không bật nhiều instance với SQLite trên persistent disk; mô hình này dùng một instance.
