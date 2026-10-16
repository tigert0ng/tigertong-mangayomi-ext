const mangayomiSources = [
  {
    "name": "TruyenVI",
    "lang": "vi",
    "baseUrl": "https://truyenvi.com",
    "apiUrl": "",
    "iconUrl": "https://truyenvi.com/img/ktt_logo.png",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.0.3",
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

  // Sửa lỗi font: nếu app giải mã nhầm UTF-8 thành Latin-1/cp1252 (vd "Ã¡" thay vì "á")
  // thì đổi ngược về byte rồi giải mã lại UTF-8. Chuỗi đã đúng thì giữ nguyên.
  fixEncoding(s) {
    if (!s || !/[\u00C2\u00C3\u00C4\u00C6\u00E1][\u0080-\u00BF\u0152-\u2122]/.test(s)) return s;
    const cp = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
    try {
      let bin = "";
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (cp[c] !== undefined) c = cp[c];
        if (c > 255) return s; // có ký tự thật ngoài Latin-1 => chuỗi không bị lỗi kiểu này
        bin += String.fromCharCode(c);
      }
      return decodeURIComponent(escape(bin));
    } catch (e) {
      return s;
    }
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
    return this.parseList(this.fixEncoding(res.body));
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
    const result = this.parseList(this.fixEncoding(res.body));
    result.hasNextPage = false; // kết quả tìm kiếm chưa thấy phân trang
    return result;
  }

  // ---------- detail ----------

  async getDetail(url) {
    const res = await this.client.get(this.absUrl(url), this.getHeaders());
    const doc = new Document(this.fixEncoding(res.body));

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
    const doc = new Document(this.fixEncoding(res.body));
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