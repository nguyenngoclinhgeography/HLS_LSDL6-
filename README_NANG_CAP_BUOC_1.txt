HỌC LIỆU SỐ LỊCH SỬ VÀ ĐỊA LÍ 6 - NÂNG CẤP BƯỚC 1

Bản này là bản sửa lại của bước 1.

1. FILE MỚI
   js/hls6-core.js
   Đây là bộ não dùng chung cho hồ sơ học sinh, tiến trình và điểm quiz.

2. BA FILE THỬ NGHIỆM ĐÃ KẾT NỐI
   index.html
   g01.html
   h01.html

3. LINK ĐÃ KIỂM TRA
   - index -> g01/g02/.../g30 và h01/h02/.../h20: đường dẫn cùng thư mục.
   - Đã sửa 3 link ../index.html bị sai trong h07.html, h15.html và tc.html thành index.html.
   - js/hls6-core.js được tham chiếu bằng đường dẫn tương đối chính xác từ 3 file thử nghiệm.

4. CÁCH TEST KHUYẾN NGHỊ
   Nếu mở trực tiếp bằng double-click mà trình duyệt có hành vi lạ, hãy chạy thư mục DP bằng Live Server hoặc một static server.
   Sau đó mở index.html.

   Luồng test:
   - Nhập họ tên + lớp.
   - Vào Địa lí -> Bài 1.
   - Làm quiz -> Hoàn thành bài.
   - Quay về trang chủ.
   - Hồ sơ học tập phải cập nhật số bài và điểm.
   - Thử H01 tương tự.

5. LƯU Ý
   Bản này CHƯA có cơ sở dữ liệu online. Điểm vẫn được lưu trong localStorage của trình duyệt.
   Chưa tích hợp radar chart và dashboard giáo viên.
