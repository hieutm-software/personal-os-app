<script lang="ts">
  import {
    BookOpen,
    Languages,
    Search,
    CheckSquare,
    FolderOpen,
    ShieldCheck,
    Calendar as CalendarIcon,
    HardDrive,
    Sparkles,
    Keyboard,
    HelpCircle,
    AlertTriangle,
    Info,
    CheckCircle2,
    Sliders,
    Home,
  } from "lucide-svelte";
  import { shortcutStore } from "../../shared/shortcutStore.svelte";

  type SupportedLanguage = "vi" | "en";

  interface GuideSection {
    id: string;
    icon: any;
    category: string;
    title: string;
    summary: string;
    highlights?: string[];
    steps: Array<{
      title: string;
      desc: string;
      badge?: string;
      shortcutKey?: string;
    }>;
    callout?: {
      type: "info" | "tip" | "warning";
      title: string;
      message: string;
    };
  }

  interface FaqItem {
    question: string;
    answer: string;
    category: string;
  }

  interface TranslationBundle {
    badge: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    noResults: string;
    langButton: string;
    allTab: string;
    categories: Record<string, string>;
    shortcutsTitle: string;
    shortcutsSubtitle: string;
    customizableNote: string;
    faqTitle: string;
    faqSubtitle: string;
    sections: GuideSection[];
    faqs: FaqItem[];
  }

  const GUIDE_CONTENT: Record<SupportedLanguage, TranslationBundle> = {
    vi: {
      badge: "Trung tâm Hướng dẫn",
      title: "Khám phá Personal OS",
      subtitle:
        "Không gian làm việc cá nhân cục bộ (Local-First), nhanh và bảo mật. Hướng dẫn ngắn gọn về các phân hệ và phím tắt.",
      searchPlaceholder: "Tìm tính năng, phím tắt (ví dụ: thùng rác, két sắt, sao lưu, kanban...)",
      noResults: "Không tìm thấy nội dung phù hợp với từ khóa của bạn.",
      langButton: "English",
      allTab: "Tất cả",
      categories: {
        overview: "Tổng quan",
        tasks: "Công việc",
        calendar: "Lịch",
        docs: "Tài liệu & Markdown",
        vault: "Két sắt",
        backup: "Sao lưu",
        settings: "Cài đặt & Sức khỏe",
        shortcuts: "Phím tắt",
        faq: "Hỏi đáp (FAQ)",
      },
      shortcutsTitle: "Phím tắt hệ thống",
      shortcutsSubtitle: "Thao tác nhanh bằng bàn phím.",
      customizableNote: "Tùy chỉnh trong Cài đặt > Phím tắt.",
      faqTitle: "Câu hỏi thường gặp (FAQ)",
      faqSubtitle: "Giải đáp ngắn gọn về lưu trữ, bảo mật và vận hành.",
      sections: [
        {
          id: "overview",
          icon: Home,
          category: "overview",
          title: "1. Tổng quan & Dashboard",
          summary: "Trung tâm điều hành cục bộ, hiển thị tiến độ công việc, lịch trình trong ngày, thời tiết và thông số hệ thống.",
          highlights: [
            "100% Local-First: Dữ liệu lưu trực tiếp trên ổ cứng qua SQLite và tệp tin cục bộ.",
            "Giám sát thời gian thực: Hiển thị độ trễ DB, dung lượng lưu trữ và tốc độ mạng.",
            "Widget thông minh: Thời tiết, đếm ngược hạn công việc và lịch hẹn sắp tới.",
          ],
          steps: [
            {
              title: "Thanh điều hướng (Activity Bar)",
              desc: "Chuyển đổi nhanh giữa Dashboard, Công việc (Tasks), Lịch (Calendar), Tài liệu (Documents), Két sắt (Vault) và Cài đặt (Settings).",
            },
            {
              title: "Màn hình Dashboard",
              desc: "Theo dõi công việc đang chờ/đã xong theo nhóm và lịch trình sự kiện trong ngày.",
            },
            {
              title: "Bảng lệnh nhanh (Command Palette)",
              desc: "Tìm kiếm tức thì công việc, tài liệu và chuyển nhanh giữa các phân hệ.",
              badge: "Khuyên dùng",
              shortcutKey: "Ctrl + K",
            },
          ],
          callout: {
            type: "info",
            title: "Quyền riêng tư tuyệt đối",
            message:
              "Ứng dụng hoạt động hoàn toàn độc lập trên máy tính của bạn, không thu thập dữ liệu hay gửi thông tin ra bên ngoài.",
          },
        },
        {
          id: "tasks",
          icon: CheckSquare,
          category: "tasks",
          title: "2. Quản lý Công việc (Tasks)",
          summary: "Theo dõi công việc với bảng Kanban và danh sách bảng biểu, hỗ trợ phân nhóm đa cấp và đính kèm tài liệu Markdown.",
          highlights: [
            "2 Chế độ xem: Bảng Kanban trực quan và Danh sách (List) có thể kéo chỉnh độ rộng cột.",
            "Nhóm đa cấp: Tổ chức theo Nhóm cha / Nhóm con với tên duy nhất.",
            "Kéo thả linh hoạt: Kéo thẻ giữa các cột hoặc chọn nhiều việc để chuyển nhóm cùng lúc.",
          ],
          steps: [
            {
              title: "Tạo nhóm & Nhóm con",
              desc: "Bấm '+ Nhóm mới' ở thanh bên trái để tạo nhóm độc lập hoặc nhóm con.",
            },
            {
              title: "Thêm công việc mới",
              desc: "Nhập tiêu đề, hạn chót, chọn nhóm và đính kèm nội dung Markdown chi tiết cho công việc.",
              shortcutKey: "Ctrl + T",
            },
            {
              title: "Soạn thảo chi tiết công việc",
              desc: "Mở khung soạn thảo Markdown ngay trên từng công việc để lưu checklist, hướng dẫn hoặc đoạn code.",
            },
            {
              title: "Lọc & Sắp xếp nhanh",
              desc: "Đặt nhanh hạn chót (Hôm nay, Ngày mai, Tuần tới) và lọc theo trạng thái: Tất cả, Chưa xong, Đã xong.",
            },
          ],
          callout: {
            type: "tip",
            title: "Thao tác hàng loạt",
            message:
              "Tích chọn nhiều công việc rồi kéo thả bất kỳ hàng nào vào nhóm bên trái để di chuyển tất cả cùng lúc.",
          },
        },
        {
          id: "calendar",
          icon: CalendarIcon,
          category: "calendar",
          title: "3. Lịch & Sự kiện (Calendar)",
          summary: "Quản lý lịch biểu theo tháng/danh sách, hỗ trợ lặp lại định kỳ và đồng bộ một chiều từ Google Calendar.",
          highlights: [
            "2 Chế độ xem: Lưới tháng (Grid) và Danh sách sự kiện (Events).",
            "Sự kiện lặp lại: Lặp theo Ngày, Tuần, Tháng hoặc Năm.",
            "Đồng bộ Google Calendar: Tải lịch tự động qua đường dẫn iCal (.ics) bí mật.",
          ],
          steps: [
            {
              title: "Tạo sự kiện",
              desc: "Nhấp đúp vào ô ngày trên lịch hoặc dùng phím tắt để thêm sự kiện mới.",
              shortcutKey: "Ctrl + E",
            },
            {
              title: "Thiết lập thời gian & Lặp lại",
              desc: "Chọn sự kiện cả ngày (All-day) hoặc giờ cụ thể, kèm tùy chọn chu kỳ lặp lại.",
            },
            {
              title: "Đồng bộ Google Calendar",
              desc: "Vào Cài đặt > Đồng bộ Google Calendar, dán link 'Địa chỉ bí mật ở định dạng iCal' (.ics) và bấm Đồng bộ.",
            },
          ],
          callout: {
            type: "info",
            title: "Lấy link iCal từ Google Calendar",
            message:
              "Mở Google Calendar trên web > Cài đặt lịch > Tích hợp lịch > Sao chép 'Địa chỉ bí mật ở định dạng iCal' và dán vào ứng dụng.",
          },
        },
        {
          id: "docs",
          icon: FolderOpen,
          category: "docs",
          title: "4. Tài liệu & Soạn thảo Markdown (Documents)",
          summary: "Quản lý cây thư mục tệp tin trên ổ cứng, tích hợp trình soạn thảo Markdown 3 chế độ, xem trước đa phương tiện và Thùng rác 2 tầng.",
          highlights: [
            "Lưu trữ tệp chuẩn: Mọi tài liệu và tệp .md lưu trực tiếp trên ổ cứng, dễ dàng mở bằng bất kỳ phần mềm nào.",
            "Soạn thảo Markdown 3 chế độ: Write, Split (đồng bộ thanh lăn 2 chiều) và Preview kèm nút Copy nhanh.",
            "Xem trước đa định dạng: Xem trực tiếp PDF, ảnh, video, âm thanh và chỉnh sửa .md/.txt ngay trong app.",
          ],
          steps: [
            {
              title: "Tạo & Soạn thảo tệp Markdown",
              desc: "Nhấn nút tạo mới hoặc phím tắt Ctrl + N để mở trình soạn thảo Markdown. Hỗ trợ đồng bộ vị trí cuộn giữa Write, Split, Preview và sao chép nhanh toàn bộ nội dung.",
              shortcutKey: "Ctrl + N",
            },
            {
              title: "Cây thư mục & Kéo thả tệp",
              desc: "Duyệt cây thư mục bên trái, kéo thả tệp từ máy tính vào ứng dụng để tải lên hoặc kéo tệp thả vào thư mục để di chuyển.",
            },
            {
              title: "Mở trong File Explorer",
              desc: "Bấm biểu tượng mở thư mục để truy cập nhanh vị trí tệp thực tế trên Windows Explorer.",
            },
            {
              title: "Thùng rác 2 tầng an toàn",
              desc: "Tầng 1: Xóa trong app sẽ đưa tệp vào Thùng rác nội bộ (.trash) để khôi phục 1 chạm về đúng thư mục cũ.\nTầng 2: Xóa khỏi Thùng rác nội bộ sẽ chuyển tệp vào Windows Recycle Bin chứ không hủy vĩnh viễn ngay.",
            },
          ],
          callout: {
            type: "tip",
            title: "Đồng bộ cuộn thông minh (Sync Scroll)",
            message:
              "Trong chế độ Split, 2 khung Write và Preview tự động lăn chuột cùng nhau. Bạn có thể bấm nút 'Sync Scroll' trên thanh công cụ nếu muốn tắt khóa để cuộn độc lập 2 bên.",
          },
        },
        {
          id: "vault",
          icon: ShieldCheck,
          category: "vault",
          title: "5. Két sắt Bảo mật (Vault)",
          summary: "Lưu trữ mật khẩu và thông tin nhạy cảm với mã hóa AES-256-GCM, mở khóa bằng xác thực Windows.",
          highlights: [
            "Xác thực Hệ điều hành: Mở khóa bằng Windows Hello, mã PIN hoặc mật khẩu máy tính.",
            "Mã hóa AES-256-GCM: Toàn bộ dữ liệu được mã hóa trước khi ghi xuống đĩa.",
            "Tạo mật khẩu mạnh: Tích hợp công cụ sinh mật khẩu ngẫu nhiên an toàn.",
          ],
          steps: [
            {
              title: "Mở khóa & Khóa Két sắt",
              desc: "Bấm 'Mở khóa' và xác thực qua Windows. Khi bấm 'Khóa' hoặc đóng ứng dụng, khóa giải mã trong RAM sẽ được xóa sạch.",
            },
            {
              title: "Quản lý & Sao chép nhanh",
              desc: "Thêm tài khoản theo nhóm, ẩn/hiện mật khẩu hoặc bấm nút Copy để lấy thông tin đăng nhập vào Clipboard.",
            },
          ],
          callout: {
            type: "info",
            title: "Không cần nhớ thêm mật khẩu phụ",
            message:
              "Két sắt liên kết trực tiếp với lớp xác thực của Windows, giúp bảo mật tối đa mà không lo quên mật khẩu riêng.",
          },
        },
        {
          id: "backup",
          icon: HardDrive,
          category: "backup",
          title: "6. Sao lưu & Khôi phục (Backup & Restore)",
          summary: "Đóng gói toàn bộ dữ liệu ra file .posbackup (mã hóa AES-256-GCM) hoặc .zip, hỗ trợ đối chiếu xung đột khi khôi phục.",
          highlights: [
            "Sao lưu trọn gói: Bao gồm cơ sở dữ liệu SQLite, toàn bộ thư mục Documents và cấu hình.",
            "Bảo vệ bằng mật khẩu: Tùy chọn mã hóa tệp sao lưu bằng Argon2id + AES-256-GCM.",
            "Giải quyết xung đột: Hiển thị bảng so sánh trực quan nếu có tệp trùng tên nhưng khác nội dung.",
          ],
          steps: [
            {
              title: "Xuất bản sao lưu (Export)",
              desc: "Vào Cài đặt > Sao lưu dữ liệu > Xuất sao lưu. Chọn đặt mật khẩu mã hóa (.posbackup) hoặc xuất file .zip.",
            },
            {
              title: "Khôi phục dữ liệu (Restore)",
              desc: "Chọn file sao lưu để khôi phục. Hệ thống tự động bổ sung mục thiếu và hỏi ý kiến bạn nếu có tệp bị xung đột nội dung.",
            },
          ],
          callout: {
            type: "tip",
            title: "Ghi nhớ mật khẩu sao lưu",
            message:
              "Nếu bạn đặt mật khẩu cho file .posbackup, hãy lưu giữ mật khẩu này cẩn thận để giải mã khi khôi phục trên máy mới.",
          },
        },
        {
          id: "settings",
          icon: Sliders,
          category: "settings",
          title: "7. Cài đặt & Sức khỏe (Settings & Wellness)",
          summary: "Tùy chỉnh giao diện Sáng/Tối, đường dẫn thư mục, tự động dọn rác và 3 bộ nhắc nhở sức khỏe.",
          highlights: [
            "Nhắc nhở sức khỏe: Nhắc uống nước, nhắc đứng dậy vận động và bảo vệ mắt 20-20-20.",
            "Dọn rác tự động: Tự động làm sạch thùng rác theo chu kỳ (3 ngày đến 1 tháng).",
            "Tùy biến linh hoạt: Đổi thư mục lưu trữ Documents/Downloads và phím tắt hệ thống.",
          ],
          steps: [
            {
              title: "Giao diện & Phím tắt",
              desc: "Chuyển đổi chế độ Sáng (Light), Tối (Dark) hoặc Theo hệ thống (System) và gán lại các phím tắt.",
            },
            {
              title: "Bật nhắc nhở sức khỏe",
              desc: "Thiết lập chu kỳ nhắc uống nước, nhắc vận động và nghỉ mắt 20 giây sau mỗi 20 phút làm việc.",
            },
            {
              title: "Đường dẫn & Dọn rác",
              desc: "Chọn thư mục lưu trữ tùy chỉnh và bật chế độ tự động dọn mục đã xóa quá hạn.",
            },
          ],
        },
      ],
      faqs: [
        {
          category: "Lưu trữ",
          question: "Dữ liệu của tôi được lưu ở đâu?",
          answer:
            "Toàn bộ dữ liệu được lưu 100% trên ổ cứng máy tính của bạn (trong cơ sở dữ liệu SQLite cục bộ và thư mục Documents). Ứng dụng không sử dụng máy chủ đám mây.",
        },
        {
          category: "Két sắt",
          question: "Két sắt (Vault) mở khóa bằng mật khẩu nào?",
          answer:
            "Bạn mở khóa trực tiếp bằng mã PIN, mật khẩu Windows hoặc Windows Hello của máy tính đang dùng, không cần tạo mật khẩu riêng.",
        },
        {
          category: "Sao lưu",
          question: "Làm sao để chuyển dữ liệu sang máy tính mới?",
          answer:
            "Ở máy cũ, vào Cài đặt > Sao lưu dữ liệu > Xuất sao lưu. Chép file đó sang máy mới, vào Cài đặt > Khôi phục dữ liệu và chọn file vừa chép là toàn bộ dữ liệu sẽ được phục hồi.",
        },
        {
          category: "Tài liệu",
          question: "Thùng rác 2 tầng trong Documents hoạt động thế nào?",
          answer:
            "Khi xóa lần 1, tệp vào Thùng rác trong ứng dụng (.trash) để bạn có thể khôi phục 1 chạm. Khi xóa khỏi Thùng rác ứng dụng, tệp được chuyển vào Recycle Bin của Windows chứ không mất hẳn ngay.",
        },
        {
          category: "Phân nhóm",
          question: "Tại sao không thể đặt trùng tên Nhóm?",
          answer:
            "Tên nhóm được đồng bộ với cấu trúc phân loại và đường dẫn lưu trữ, nên việc giữ tên duy nhất giúp tránh trùng lặp và xung đột dữ liệu.",
        },
      ],
    },
    en: {
      badge: "Help Center",
      title: "Explore Personal OS",
      subtitle:
        "A fast, private, local-first desktop workspace. Concise guide to core modules and shortcuts.",
      searchPlaceholder: "Search features, shortcuts (e.g., trash, vault, backup, kanban...)",
      noResults: "No matching guide topics found.",
      langButton: "Tiếng Việt",
      allTab: "All",
      categories: {
        overview: "Overview",
        tasks: "Tasks",
        calendar: "Calendar",
        docs: "Documents & Markdown",
        vault: "Vault",
        backup: "Backup",
        settings: "Settings & Wellness",
        shortcuts: "Shortcuts",
        faq: "FAQ",
      },
      shortcutsTitle: "Keyboard Shortcuts",
      shortcutsSubtitle: "Navigate and create items quickly.",
      customizableNote: "Customizable in Settings > Shortcuts.",
      faqTitle: "Frequently Asked Questions (FAQ)",
      faqSubtitle: "Quick answers on storage, security, and workflows.",
      sections: [
        {
          id: "overview",
          icon: Home,
          category: "overview",
          title: "1. Overview & Dashboard",
          summary: "Central local-first hub displaying task progress, daily events, weather, and live system metrics.",
          highlights: [
            "100% Local-First: Data lives on your local drive via SQLite and native files.",
            "Live Telemetry: Real-time SQLite latency, storage usage, and network speed.",
            "Smart Widgets: Weather forecast, task due countdowns, and upcoming events.",
          ],
          steps: [
            {
              title: "Activity Bar Navigation",
              desc: "Switch instantly between Dashboard, Tasks, Calendar, Documents, Vault, and Settings.",
            },
            {
              title: "Central Dashboard",
              desc: "View pending/completed tasks by group alongside today's local and Google Calendar schedule.",
            },
            {
              title: "Command Palette",
              desc: "Search across all tasks and documents or jump between modules instantly.",
              badge: "Recommended",
              shortcutKey: "Ctrl + K",
            },
          ],
          callout: {
            type: "info",
            title: "Complete Privacy",
            message:
              "Personal OS runs entirely offline-capable on your machine with zero tracking or external data collection.",
          },
        },
        {
          id: "tasks",
          icon: CheckSquare,
          category: "tasks",
          title: "2. Task Management (Tasks)",
          summary: "Track deliverables via Kanban Board or Table List with hierarchical groups and rich Markdown descriptions.",
          highlights: [
            "Dual Views: Kanban Board and resizable Table List.",
            "Nested Groups: Organize tasks into parent groups and subgroups.",
            "Drag & Drop: Move cards across columns or bulk-drag tasks into groups.",
          ],
          steps: [
            {
              title: "Create Groups & Subgroups",
              desc: "Click '+ New Group' on the sidebar to organize projects hierarchically.",
            },
            {
              title: "Add Tasks",
              desc: "Set task titles, due dates, groups, and detailed Markdown descriptions.",
              shortcutKey: "Ctrl + T",
            },
            {
              title: "Markdown Task Details",
              desc: "Open the built-in Markdown editor on any task to write checklists, specs, or code snippets.",
            },
            {
              title: "Quick Filters & Deadlines",
              desc: "Assign Today, Tomorrow, or Next Week deadlines in one click and filter by ALL, PENDING, or COMPLETED.",
            },
          ],
          callout: {
            type: "tip",
            title: "Bulk Move",
            message:
              "Select multiple tasks via checkboxes and drag any selected row into a sidebar group to move them together.",
          },
        },
        {
          id: "calendar",
          icon: CalendarIcon,
          category: "calendar",
          title: "3. Calendar & Events (Calendar)",
          summary: "Manage schedules in Monthly Grid or List view with recurring rules and one-way Google Calendar sync.",
          highlights: [
            "Dual Modes: Monthly Grid and chronological Event List.",
            "Recurring Events: Repeat Daily, Weekly, Monthly, or Yearly.",
            "Google Calendar Sync: Import events via your private iCal (.ics) URL.",
          ],
          steps: [
            {
              title: "Create Events",
              desc: "Double-click any day cell or press the shortcut to schedule an event.",
              shortcutKey: "Ctrl + E",
            },
            {
              title: "Time & Recurrence",
              desc: "Set all-day or timed spans and configure automatic repetition rules.",
            },
            {
              title: "Sync Google Calendar",
              desc: "Go to Settings > Google Calendar Sync, paste your 'Secret address in iCal format' (.ics), and click Sync Now.",
            },
          ],
          callout: {
            type: "info",
            title: "Finding your iCal URL",
            message:
              "In Google Calendar on the web > Settings > Integrate calendar > Copy the 'Secret address in iCal format'.",
          },
        },
        {
          id: "docs",
          icon: FolderOpen,
          category: "docs",
          title: "4. Documents & Markdown Editor (Documents)",
          summary: "Local filesystem hub with nested folder trees, a 3-mode Markdown editor, media previews, and double-tier trash.",
          highlights: [
            "Native Disk Files: All documents and .md files live directly in your local folder.",
            "3-Mode Markdown Editor: Write, Split (with bi-directional Sync Scroll), and Preview with 1-click Copy.",
            "Built-in Previews: View PDFs, images, audio, video, and edit .md/.txt files directly in-app.",
          ],
          steps: [
            {
              title: "Create & Edit Markdown Files",
              desc: "Press Ctrl + N to launch the Markdown editor. Switch seamlessly between Write, Split, and Preview with synchronized scrolling and quick clipboard copy.",
              shortcutKey: "Ctrl + N",
            },
            {
              title: "Directory Tree & Drag-and-Drop",
              desc: "Browse nested folders in the sidebar, drop files from your desktop to import, or drag files into folders to move them.",
            },
            {
              title: "Open in File Explorer",
              desc: "Click the external folder icon to reveal any file or directory in Windows File Explorer.",
            },
            {
              title: "Double-Tier Trash Safety",
              desc: "Tier 1: Deleting moves files to In-App Trash (.trash) for 1-click restore to their original folder.\nTier 2: Emptying In-App Trash moves files to the Windows Recycle Bin instead of permanent erasure.",
            },
          ],
          callout: {
            type: "tip",
            title: "Synchronized Scrolling",
            message:
              "In Split mode, Write and Preview panes scroll together automatically. Toggle the 'Sync Scroll' button on the toolbar anytime to scroll panes independently.",
          },
        },
        {
          id: "vault",
          icon: ShieldCheck,
          category: "vault",
          title: "5. Secure Vault (Vault)",
          summary: "Store credentials and secret notes encrypted with AES-256-GCM and unlocked via OS Authentication.",
          highlights: [
            "OS Authentication: Unlock with Windows Hello, PIN, or your system password.",
            "AES-256-GCM Encryption: All sensitive fields are encrypted client-side before storage.",
            "Password Generator: Generate strong random passwords with custom length and character rules.",
          ],
          steps: [
            {
              title: "Unlock & Lock Vault",
              desc: "Authenticate via Windows to unlock. Locking the vault or closing the app immediately wipes decrypted data from RAM.",
            },
            {
              title: "Manage & One-Click Copy",
              desc: "Organize secrets into groups, toggle visibility, or copy usernames and passwords directly to your clipboard.",
            },
          ],
          callout: {
            type: "info",
            title: "Zero Extra Master Password",
            message:
              "Vault security is backed directly by your operating system's credential prompt—no separate master password to forget.",
          },
        },
        {
          id: "backup",
          icon: HardDrive,
          category: "backup",
          title: "6. Backup & Restore (Backup)",
          summary: "Export full system archives (.posbackup encrypted with AES-256-GCM or standard .zip) with conflict resolution.",
          highlights: [
            "Full Packaging: Includes your SQLite database, Documents folder, and settings.",
            "Password Encryption: Optional Argon2id + AES-256-GCM encrypted .posbackup archives.",
            "Conflict Resolution: Side-by-side comparison modal when restoring modified files.",
          ],
          steps: [
            {
              title: "Export Backup",
              desc: "Go to Settings > Data Backup > Export Backup. Choose password encryption (.posbackup) or standard .zip.",
            },
            {
              title: "Restore Backup",
              desc: "Select a backup archive to restore. Missing items are added automatically and conflicting files prompt for your choice.",
            },
          ],
          callout: {
            type: "tip",
            title: "Backup Password",
            message:
              "Keep your backup encryption password safe—it is required to decrypt .posbackup files when migrating to a new device.",
          },
        },
        {
          id: "settings",
          icon: Sliders,
          category: "settings",
          title: "7. Settings & Wellness",
          summary: "Configure themes, custom storage paths, automated trash cleanup, and 3 ergonomic health reminders.",
          highlights: [
            "Wellness Reminders: Water intake, Sedentary stretch alerts, and 20-20-20 Eye Care.",
            "Auto Cleanup: Automatically purge expired trash items (3 days to 1 month).",
            "Custom Paths & Hotkeys: Relocate Documents/Downloads folders and rebind shortcuts.",
          ],
          steps: [
            {
              title: "Themes & Shortcuts",
              desc: "Switch between Dark, Light, or System themes and customize global keyboard shortcuts.",
            },
            {
              title: "Ergonomic Reminders",
              desc: "Enable periodic hydration tracking, movement alerts, and 20-second eye rest breaks.",
            },
            {
              title: "Storage & Cleanup",
              desc: "Set custom disk directories and configure automatic trash retention schedules.",
            },
          ],
        },
      ],
      faqs: [
        {
          category: "Storage",
          question: "Where is my data stored?",
          answer:
            "100% of your data is stored locally on your computer (inside the local SQLite database and your Documents directory). Nothing is sent to external servers.",
        },
        {
          category: "Vault",
          question: "What password unlocks the Vault?",
          answer:
            "You unlock it using your computer's native Windows PIN, password, or Windows Hello—no separate app password is required.",
        },
        {
          category: "Backup",
          question: "How do I move my data to a new computer?",
          answer:
            "Go to Settings > Data Backup > Export Backup on your old PC, copy the archive to your new PC, and use Restore Backup in Settings.",
        },
        {
          category: "Documents",
          question: "How does the Double-Tier Trash work?",
          answer:
            "Deleting a file moves it to In-App Trash (.trash) for 1-click restore. Deleting it from In-App Trash sends it to the Windows Recycle Bin rather than erasing it immediately.",
        },
        {
          category: "Groups",
          question: "Why must Group names be unique?",
          answer:
            "Unique group names prevent path collisions and keep your organizational structure clean and unambiguous.",
        },
      ],
    },
  };

  let currentLang = $state<SupportedLanguage>(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("personal_os_guide_lang") as SupportedLanguage)) ||
      "en"
  );
  let activeTab = $state<string>("all");
  let searchQuery = $state<string>("");

  let content = $derived(GUIDE_CONTENT[currentLang]);

  function toggleLanguage() {
    currentLang = currentLang === "en" ? "vi" : "en";
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("personal_os_guide_lang", currentLang);
      }
    } catch {}
  }

  function formatKey(key: string | null | undefined): string {
    if (!key) return "";
    return key.replace(/Meta/g, "Cmd");
  }

  let liveShortcuts = $derived({
    palette: formatKey(shortcutStore.config.commandPalette) || "Ctrl + K",
    task: formatKey(shortcutStore.config.newTask) || "Ctrl + T",
    note: formatKey(shortcutStore.config.newNote) || "Ctrl + N",
    event: formatKey(shortcutStore.config.newEvent) || "Ctrl + E",
  });

  let tabsContainerRef = $state<HTMLDivElement | null>(null);
  let isDragging = $state(false);
  let startX = 0;
  let scrollLeftStart = 0;
  let hasDragged = false;

  function handleTabWheel(e: WheelEvent) {
    if (!tabsContainerRef) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      tabsContainerRef.scrollLeft += e.deltaY;
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (!tabsContainerRef) return;
    isDragging = true;
    hasDragged = false;
    startX = e.pageX - tabsContainerRef.offsetLeft;
    scrollLeftStart = tabsContainerRef.scrollLeft;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !tabsContainerRef) return;
    const x = e.pageX - tabsContainerRef.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 4) {
      hasDragged = true;
    }
    tabsContainerRef.scrollLeft = scrollLeftStart - walk;
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function selectTab(catKey: string, buttonEl?: HTMLElement) {
    activeTab = catKey;
    if (buttonEl && tabsContainerRef) {
      buttonEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  let filteredSections = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    let sections = content.sections;

    if (activeTab !== "all") {
      sections = sections.filter((s) => s.category === activeTab);
    }

    if (!q) return sections;

    return sections.filter((s) => {
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchSummary = s.summary.toLowerCase().includes(q);
      const matchHighlights = s.highlights?.some((h) => h.toLowerCase().includes(q));
      const matchSteps = s.steps.some(
        (st) => st.title.toLowerCase().includes(q) || st.desc.toLowerCase().includes(q)
      );
      const matchCallout =
        s.callout && (s.callout.title.toLowerCase().includes(q) || s.callout.message.toLowerCase().includes(q));
      return matchTitle || matchSummary || matchHighlights || matchSteps || matchCallout;
    });
  });

  let filteredFaqs = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return content.faqs;
    return content.faqs.filter(
      (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
    );
  });
</script>

<div class="h-[76vh] flex flex-col -mx-2 -my-2 custom-scrollbar overflow-hidden select-text">
  <header class="px-5 py-4 border-b border-border/60 bg-background/95 backdrop-blur-sm space-y-3 shrink-0">
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <div class="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
          <BookOpen class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
              {content.badge}
            </span>
          </div>
          <h1 class="text-xl font-bold tracking-tight text-foreground">
            {content.title}
          </h1>
        </div>
      </div>

      <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-xs font-semibold text-foreground transition-all duration-150 shadow-sm hover:scale-[1.02]"
          onclick={toggleLanguage}
          title="Switch language / Đổi ngôn ngữ"
        >
          <Languages class="w-4 h-4 text-muted-foreground" />
          <span>{content.langButton}</span>
        </button>
      </div>
    </div>

    <div class="relative">
      <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        bind:value={searchQuery}
        placeholder={content.searchPlaceholder}
        class="w-full pl-9 pr-4 py-2 text-xs md:text-sm bg-muted/30 border border-border/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-muted-foreground/60 text-foreground"
      />
      {#if searchQuery.trim()}
        <button
          type="button"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/60"
          onclick={() => (searchQuery = "")}
        >
          ✕
        </button>
      {/if}
    </div>

    <div
      bind:this={tabsContainerRef}
      onwheel={handleTabWheel}
      onmousedown={handleMouseDown}
      onmousemove={handleMouseMove}
      onmouseup={handleMouseUp}
      onmouseleave={handleMouseUp}
      role="tablist"
      tabindex="0"
      class="flex items-center gap-1.5 overflow-x-auto pb-1.5 pt-0.5 text-xs select-none scroll-smooth tab-scroll-container focus:outline-none w-full {isDragging ? 'cursor-grabbing' : 'cursor-grab'}"
      style="scrollbar-width: thin; -webkit-overflow-scrolling: touch;"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'all'}
        class="px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors shrink-0 {activeTab === 'all'
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70'}"
        onclick={(e) => {
          if (hasDragged) return;
          selectTab("all", e.currentTarget);
        }}
      >
        {content.allTab}
      </button>
      {#each Object.entries(content.categories) as [catKey, catLabel] (catKey)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === catKey}
          class="px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors shrink-0 {activeTab === catKey
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/70'}"
          onclick={(e) => {
            if (hasDragged) return;
            selectTab(catKey, e.currentTarget);
          }}
        >
          {catLabel}
        </button>
      {/each}
    </div>
  </header>

  <main class="flex-1 overflow-y-auto px-5 py-6 space-y-8 custom-scrollbar">
    {#if (activeTab === "all" || activeTab === "shortcuts") && (!searchQuery.trim() || "phím tắt shortcuts command palette".includes(searchQuery.trim().toLowerCase()))}
      <section class="p-5 rounded-2xl border border-border/80 bg-card/60 shadow-sm space-y-4">
        <div class="flex items-center justify-between border-b border-border/50 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
              <Keyboard class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-foreground">{content.shortcutsTitle}</h3>
              <p class="text-xs text-muted-foreground">{content.shortcutsSubtitle}</p>
            </div>
          </div>
          <span class="text-xs text-muted-foreground hidden sm:inline-block">
            {content.customizableNote}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between">
            <span class="text-xs font-medium text-foreground">Command Palette</span>
            <kbd class="px-2 py-1 bg-background border border-border rounded-md text-xs font-terminal font-semibold shadow-xs">
              {liveShortcuts.palette}
            </kbd>
          </div>
          <div class="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between">
            <span class="text-xs font-medium text-foreground">
              {currentLang === "vi" ? "Tạo công việc mới" : "New Task"}
            </span>
            <kbd class="px-2 py-1 bg-background border border-border rounded-md text-xs font-terminal font-semibold shadow-xs">
              {liveShortcuts.task}
            </kbd>
          </div>
          <div class="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between">
            <span class="text-xs font-medium text-foreground">
              {currentLang === "vi" ? "Tạo tài liệu Markdown" : "New Markdown File"}
            </span>
            <kbd class="px-2 py-1 bg-background border border-border rounded-md text-xs font-terminal font-semibold shadow-xs">
              {liveShortcuts.note}
            </kbd>
          </div>
          <div class="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between">
            <span class="text-xs font-medium text-foreground">
              {currentLang === "vi" ? "Tạo sự kiện mới" : "New Event"}
            </span>
            <kbd class="px-2 py-1 bg-background border border-border rounded-md text-xs font-terminal font-semibold shadow-xs">
              {liveShortcuts.event}
            </kbd>
          </div>
        </div>
      </section>
    {/if}

    {#if filteredSections.length === 0 && (activeTab !== "faq" && activeTab !== "shortcuts")}
      <div class="text-center py-12 space-y-3">
        <HelpCircle class="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p class="text-sm text-muted-foreground">{content.noResults}</p>
      </div>
    {:else}
      <div class="space-y-6">
        {#each filteredSections as section (section.id)}
          <article class="p-5 rounded-2xl border border-border/70 bg-card/40 shadow-xs hover:border-border transition-all duration-200 space-y-4">
            <div class="flex items-start justify-between gap-3 border-b border-border/40 pb-3">
              <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                  <section.icon class="w-4 h-4" />
                </div>
                <div>
                  <h3 class="text-base font-bold text-foreground">
                    {section.title}
                  </h3>
                  <p class="text-xs text-muted-foreground">
                    {section.summary}
                  </p>
                </div>
              </div>
            </div>

            {#if section.highlights && section.highlights.length > 0}
              <div class="grid grid-cols-1 md:grid-cols-3 gap-2 py-1">
                {#each section.highlights as hl (hl)}
                  <div class="flex items-start gap-2 p-2.5 rounded-xl bg-muted/20 border border-border/40 text-xs text-muted-foreground">
                    <CheckCircle2 class="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span class="leading-relaxed">{hl}</span>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="space-y-2.5 pt-1">
              {#each section.steps as step, stepIdx (step.title)}
                <div class="flex items-start gap-3 p-3 rounded-xl bg-muted/15 border border-border/30 hover:bg-muted/30 transition-colors">
                  <span class="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {stepIdx + 1}
                  </span>
                  <div class="flex-1 space-y-1">
                    <div class="flex items-center gap-2">
                      <h4 class="text-xs font-bold text-foreground">{step.title}</h4>
                      {#if step.badge}
                        <span class="px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                          {step.badge}
                        </span>
                      {/if}
                      {#if step.shortcutKey}
                        <kbd class="ml-auto px-1.5 py-0.5 bg-background border border-border rounded text-xs font-terminal font-semibold">
                          {step.shortcutKey}
                        </kbd>
                      {/if}
                    </div>
                    <p class="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                      {step.desc}
                    </p>
                  </div>
                </div>
              {/each}
            </div>

            {#if section.callout}
              <div
                class="flex items-start gap-3 p-3.5 rounded-xl text-xs leading-relaxed {section.callout.type === 'warning'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                  : section.callout.type === 'tip'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : 'bg-primary/10 text-primary border border-primary/20'}"
              >
                {#if section.callout.type === 'warning'}
                  <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                {:else if section.callout.type === 'tip'}
                  <Sparkles class="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                {:else}
                  <Info class="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                {/if}
                <div>
                  <strong class="font-semibold block mb-0.5">{section.callout.title}</strong>
                  <span>{section.callout.message}</span>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}

    {#if (activeTab === "all" || activeTab === "faq") && filteredFaqs.length > 0}
      <section class="space-y-4 pt-4 border-t border-border/50">
        <div class="flex items-center gap-2.5">
          <div class="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
            <HelpCircle class="w-4 h-4" />
          </div>
          <div>
            <h3 class="font-bold text-sm text-foreground">{content.faqTitle}</h3>
            <p class="text-xs text-muted-foreground">{content.faqSubtitle}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {#each filteredFaqs as faq (faq.question)}
            <div class="p-4 rounded-xl border border-border/60 bg-muted/15 space-y-2 hover:border-border transition-colors">
              <div class="flex items-center gap-2">
                <span class="px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-muted text-muted-foreground border border-border">
                  {faq.category}
                </span>
                <h4 class="text-xs font-bold text-foreground leading-snug">
                  {faq.question}
                </h4>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed pl-1">
                {faq.answer}
              </p>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </main>
</div>

<style>
  .tab-scroll-container::-webkit-scrollbar {
    height: 0.25rem;
    display: block;
  }
  .tab-scroll-container::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }
  .tab-scroll-container::-webkit-scrollbar-track {
    background: transparent;
  }
  .tab-scroll-container::-webkit-scrollbar-thumb {
    background: rgba(150, 150, 150, 0.3);
    border-radius: 9999px;
  }
  .tab-scroll-container::-webkit-scrollbar-thumb:hover {
    background: rgba(150, 150, 150, 0.6);
  }
</style>
