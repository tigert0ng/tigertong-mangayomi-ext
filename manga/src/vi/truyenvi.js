const mangayomiSources = [
  {
    "name": "TruyenVI",
    "lang": "vi",
    "baseUrl": "https://truyenvi.com",
    "apiUrl": "",
    "iconUrl": "https://truyenvi.com/img/ktt_logo.png",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.0.2",
    "pkgPath": "manga/src/vi/truyenvi.js",
    "isNsfw": true
  }
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  // ---------- helpers ----------

  getHeaders(url) {
    return {
      "Referer": this.source.baseUrl + "/",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
    };
  }

  absUrl(u) {
    if (!u) return "";
    if (u.startsWith("http")) return u;
    if (u.startsWith("//")) return "https:" + u;
    return this.source.baseUrl + (u.startsWith("/") ? u : "/" + u);
  }

  // Lưu path tương đối (/truyen/slug/) để đổi domain không hỏng thư viện
  relPath(u) {
    return this.absUrl(u).replace(this.source.baseUrl, "");
  }

  // "14-10-2026" hoặc "14-10-2026 13:07:53" -> millisecondsSinceEpoch (string)
  parseDate(s) {
    const m = (s || "").match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (!m) return String(new Date().getTime());
    return String(new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getTime());
  }

  parseList(html) {
    const doc = new Document(html);
    const list = [];
    const seen = {};
    // Mỗi truyện là 1 thẻ h5 chứa a.rdthumbs; ảnh bìa nằm cùng khối .browse-bookcontent
    const cards = doc.select("div.browse-bookcontent");
    for (const card of cards) {
      const a = card.selectFirst("h5 a") || card.selectFirst("a[href*='/truyen/']");
      if (!a) continue;
      const link = this.relPath(a.attr("href"));
      if (!link.includes("/truyen/") || seen[link]) continue;
      seen[link] = true;
      const img = card.selectFirst("img");
      list.push({
        name: (a.attr("title") || a.text || "").trim(),
        link: link,
        imageUrl: img ? this.absUrl(img.attr("src")) : ""
      });
    }
    const pager = doc.select("ul.tsc_pagination a");
    let hasNextPage = false;
    for (const p of pager) {
      if (p.text.trim() === "Sau") hasNextPage = true;
    }
    return { list, hasNextPage };
  }

  async getListPage(path) {
    const res = await this.client.get(this.source.baseUrl + path, this.getHeaders());
    return this.parseList(res.body);
  }

  // ---------- list endpoints ----------

  async getPopular(page) {
    return await this.getListPage("/danh-sach-truyen/xem-nhieu/" + page);
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    return await this.getListPage("/danh-sach-truyen/cap-nhat-chuong-moi/" + page);
  }

  // Form tìm kiếm của site: <form method="post"> với input name="truyen_name".
  // CHƯA xác minh endpoint kết quả: nếu rỗng, kiểm tra Network trên trình duyệt
  // khi tìm trên site rồi chỉnh lại URL bên dưới.
  async search(query, page, filters) {
    const res = await this.client.post(
      this.source.baseUrl + "/",
      this.getHeaders(),
      { "truyen_name": query }
    );
    const result = this.parseList(res.body);
    result.hasNextPage = false; // kết quả tìm kiếm chưa thấy phân trang
    return result;
  }

  // ---------- detail ----------

  async getDetail(url) {
    const res = await this.client.get(this.absUrl(url), this.getHeaders());
    const doc = new Document(res.body);

    const titleEl = doc.selectFirst("h1");
    const name = titleEl ? titleEl.text.trim() : "";

    const coverEl = doc.selectFirst("img.img-fluid.w-100.rounded");
    const imageUrl = coverEl ? this.absUrl(coverEl.attr("src")) : "";

    let author = "";
    const genre = [];
    for (const row of doc.select("div.text-dark.font-weight-bold")) {
      const t = row.text.trim();
      if (t.startsWith("Tác giả:")) {
        author = t.replace("Tác giả:", "").trim();
        if (author === "Đang cập nhật") author = "";
      } else if (t.startsWith("Thể loại:")) {
        for (const g of row.select("a")) genre.push(g.text.trim());
      }
    }

    // Site đánh dấu ✅ cạnh tên ở breadcrumb khi truyện đã hoàn thành
    const crumbs = doc.select("ol.breadcrumb li, ul.breadcrumb li");
    let status = 0; // 0 = đang tiến hành
    for (const c of crumbs) {
      if (c.text.includes("✅")) status = 1;
    }

    const chapters = [];
    for (const row of doc.select("table.table tbody tr")) {
      const a = row.selectFirst("a[href*='/truyen/']");
      if (!a) continue;
      const tds = row.select("td");
      const dateText = tds.length > 2 ? tds[2].text.trim() : "";
      chapters.push({
        name: (a.attr("title") || a.text || "").trim(),
        url: this.relPath(a.attr("href")),
        dateUpload: this.parseDate(dateText),
        scanlator: ""
      });
    }

    return {
      name,
      imageUrl,
      author,
      description: "",
      genre,
      status,
      chapters,
      link: this.absUrl(url)
    };
  }

  // ---------- reader ----------

  // Ảnh trang nằm sẵn trong HTML gốc (không cần JS), dạng
  // <div class="iq-card-body text-center"><div><img class="img-fluid" src="...">
  // src hiện đi qua proxy external-content.duckduckgo.com nên không cần Referer.
  async getPageList(url) {
    const res = await this.client.get(this.absUrl(url), this.getHeaders());
    const doc = new Document(res.body);
    const pages = [];
    for (const img of doc.select("div.iq-card-body.text-center img.img-fluid")) {
      const src = img.attr("data-src") || img.attr("src");
      if (src && src.startsWith("http")) pages.push(src);
    }
    return pages;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}