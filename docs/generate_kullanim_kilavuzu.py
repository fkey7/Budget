import os
from textwrap import wrap

class SimplePDF:
    def __init__(self):
        self.objects = []
        self.pages = []
        self.font_obj = self._add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        self.bold_font_obj = self._add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    def _add_obj(self, content):
        self.objects.append(content)
        return len(self.objects)

    @staticmethod
    def esc(text):
        return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    def add_page(self, drawing_commands):
        stream = "\n".join(drawing_commands)
        tr_map = str.maketrans({'ı':'i','İ':'I','ğ':'g','Ğ':'G','ş':'s','Ş':'S','ç':'c','Ç':'C','ö':'o','Ö':'O','ü':'u','Ü':'U'})
        stream = stream.translate(tr_map)
        stream = stream.encode('latin-1', errors='replace').decode('latin-1')
        content = f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream"
        content_obj = self._add_obj(content)
        page_dict = (
            "<< /Type /Page /Parent {PAGES} 0 R "
            "/MediaBox [0 0 595 842] "
            f"/Contents {content_obj} 0 R "
            f"/Resources << /Font << /F1 {self.font_obj} 0 R /F2 {self.bold_font_obj} 0 R >> >> >>"
        )
        self.pages.append(page_dict)

    def save(self, path):
        page_objs = [self._add_obj(p) for p in self.pages]
        kids = " ".join(f"{n} 0 R" for n in page_objs)
        pages_obj = self._add_obj(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_objs)} >>")
        self.objects = [o.replace('{PAGES}', str(pages_obj)) for o in self.objects]
        catalog_obj = self._add_obj(f"<< /Type /Catalog /Pages {pages_obj} 0 R >>")

        offsets = [0]
        body = ["%PDF-1.4\n%âãÏÓ\n"]
        cur = len(body[0].encode('latin-1'))
        for i, obj in enumerate(self.objects, 1):
            block = f"{i} 0 obj\n{obj}\nendobj\n"
            offsets.append(cur)
            body.append(block)
            cur += len(block.encode('latin-1'))

        xref_pos = cur
        xref = [f"xref\n0 {len(self.objects)+1}\n", "0000000000 65535 f \n"]
        for off in offsets[1:]:
            xref.append(f"{off:010d} 00000 n \n")
        trailer = (
            f"trailer\n<< /Size {len(self.objects)+1} /Root {catalog_obj} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        )
        data = "".join(body + xref + [trailer])
        with open(path, 'wb') as f:
            f.write(data.encode('latin-1', errors='replace'))


def draw_text_block(cmds, x, y, text, width=86, size=11, leading=15, bold=False):
    font = '/F2' if bold else '/F1'
    lines = []
    for para in text.split('\n'):
        if not para.strip():
            lines.append("")
            continue
        lines.extend(wrap(para, width=width))
    yy = y
    for line in lines:
        if line:
            cmds.append(f"BT {font} {size} Tf {x} {yy} Td ({SimplePDF.esc(line)}) Tj ET")
        yy -= leading
    return yy


def button_legend(cmds, x, y, num, label):
    cmds.append(f"0.15 0.45 0.85 rg {x} {y-12} 20 20 re f")
    cmds.append(f"1 1 1 rg BT /F2 11 Tf {x+7} {y-1} Td ({num}) Tj ET")
    cmds.append("0 0 0 rg")
    cmds.append(f"BT /F1 11 Tf {x+28} {y} Td ({SimplePDF.esc(label)}) Tj ET")


def app_wireframe(cmds, title, buttons):
    cmds.append("0.95 0.97 1 rg 40 120 515 680 re f")
    cmds.append("0.2 0.5 0.8 RG 2 w 40 120 515 680 re S")
    cmds.append("0.1 0.45 0.75 rg 40 740 515 60 re f")
    cmds.append("1 1 1 rg BT /F2 16 Tf 60 765 Td (%s) Tj ET" % SimplePDF.esc(title))
    cmds.append("0.98 0.98 0.98 rg 60 650 220 70 re f 315 650 220 70 re f")
    cmds.append("0.9 0.93 0.97 rg 60 560 475 70 re f")
    cmds.append("0.94 0.97 0.94 rg 60 470 475 70 re f")
    cmds.append("0.97 0.94 0.94 rg 60 380 475 70 re f")
    cmds.append("0.92 0.92 0.92 rg 60 170 475 180 re f")
    cmds.append("0 0 0 rg")
    basey = 330
    for i, label in enumerate(buttons, 1):
        button_legend(cmds, 70, basey - (i-1)*24, str(i), label)


def main():
    pdf = SimplePDF()

    p1 = []
    p1.append("0.07 0.43 0.75 rg 0 0 595 842 re f")
    p1.append("1 1 1 rg BT /F2 30 Tf 60 720 Td (Bütçe Takip Uygulaması) Tj ET")
    p1.append("1 1 1 rg BT /F2 24 Tf 60 680 Td (Kapsamlı Kullanım Kılavuzu) Tj ET")
    p1.append("1 1 1 rg BT /F1 14 Tf 60 630 Td (Hazırlayan: Codex teknik dokümantasyon asistanı) Tj ET")
    p1.append("1 1 1 rg BT /F1 12 Tf 60 600 Td (Bu kılavuz, uygulamayı sıfırdan kullanmaya başlamak için hazırlanmıştır.) Tj ET")
    p1.append("1 1 1 rg BT /F1 12 Tf 60 575 Td (Her bölümde: hangi ekrana gireceğiniz ve hangi düğmeye basacağınız net olarak belirtilir.) Tj ET")
    pdf.add_page(p1)

    p2 = []
    y = 790
    y = draw_text_block(p2, 50, y, "1) UYGULAMANIN AMACI", size=16, bold=True, width=60)
    y = draw_text_block(p2, 50, y-5, "Bu uygulama; gelir, gider, bilanço varlık/borç ve döviz bazlı bütçe planını tek ekrandan takip etmenizi sağlar. Planladığınız tutarlar ile gerçekleşen tutarları karşılaştırır, aylık ve yıllık görünüm sunar.", width=90)
    y = draw_text_block(p2, 50, y-10, "2) TEMEL BÖLÜMLER", size=16, bold=True, width=60)
    y = draw_text_block(p2, 50, y-5, "• Bütçe sekmesi: Kategori tanımları, planlar, grafikler ve özet kartlar\n• İşlemler sekmesi: Tüm gelir/gider hareketlerinin listesi\n• Bilanço sekmesi: Varlık, borç ve özkaynak takibi\n• Üst menü: Tema, dil, PDF/Excel rapor, veri yönetimi, kur yönetimi", width=90)
    y = draw_text_block(p2, 50, y-10, "3) BAŞLAMADAN ÖNCE", size=16, bold=True, width=60)
    draw_text_block(p2, 50, y-5, "Önerilen sıralama: (1) Döviz kurlarını girin, (2) gelir/gider kategorilerini oluşturun, (3) işlemleri kaydedin, (4) aylık-yıllık raporları alın.", width=90)
    pdf.add_page(p2)

    p3 = []
    app_wireframe(p3, "Ana Ekran (Bütçe)", [
        "Yıl değiştir: Sol/Sağ ok düğmeleri",
        "Aylık/Yıllık görünüm seçici",
        "Ay değiştir: Sol/Sağ ok düğmeleri",
        "Gelir plan/gerçekleşen kartı",
        "Gider plan/gerçekleşen kartı",
        "Net durum kartı",
        "Sekmeler: Bütçe - İşlemler - Bilanço",
    ])
    pdf.add_page(p3)

    p4 = []
    y = 790
    y = draw_text_block(p4, 50, y, "4) GELİR/GİDER KATEGORİSİ EKLEME", size=16, bold=True)
    y = draw_text_block(p4, 50, y-10, "Adımlar:")
    y = draw_text_block(p4, 70, y-5, "1. Bütçe sekmesinde GELİR veya GİDER başlığındaki + düğmesine basın.\n2. Açılan pencerede kategori adını yazın.\n3. İkon seçin.\n4. Para birimini seçin (USD, TRY, RUB).\n5. Yıllık bütçeyi girin veya aylık kutuları tek tek doldurun.\n6. Günlük Takip seçeneğini sadece günlük harcamalarda açın.\n7. Kaydet düğmesine basın.", width=82)
    y = draw_text_block(p4, 50, y-10, "İPUCU:", bold=True)
    draw_text_block(p4, 70, y-5, "Düzenli sabit giderlerde (kira, okul, aidat) günlük takip kapalı olmalı. Market/yemek/ulaşım gibi sık işlemlerde açık bırakmanız önerilir.", width=82)
    pdf.add_page(p4)

    p5 = []
    y = 790
    y = draw_text_block(p5, 50, y, "5) YENİ İŞLEM EKLEME (FAB +)", size=16, bold=True)
    y = draw_text_block(p5, 50, y-10, "Adımlar:")
    y = draw_text_block(p5, 70, y-5, "1. Alt sağ köşedeki + düğmesine basın.\n2. İşlem tipi seçin: Gelir veya Gider.\n3. Kategori kartlarından uygun kategoriyi seçin.\n4. Tutarı girin.\n5. Para birimini seçin.\n6. Tarih alanını kontrol edin.\n7. Açıklama (isteğe bağlı) yazın.\n8. Kaydet ile işlemi tamamlayın.", width=82)
    y = draw_text_block(p5, 50, y-10, "Canlı kur kutusu:", bold=True)
    draw_text_block(p5, 70, y-5, "TRY/RUB seçiminde sistem USD karşılığını anlık gösterir. Böylece farklı para birimleri tek raporda doğru kıyaslanır.", width=82)
    pdf.add_page(p5)

    p6 = []
    app_wireframe(p6, "İşlemler Sekmesi", [
        "Ay filtresi ile dönem seç",
        "Liste öğesinde düzenle düğmesi",
        "Liste öğesinde sil düğmesi",
        "Üstte toplam ve para birimi özetleri",
        "Alt sekmeden Bilanço ekranına geç",
    ])
    pdf.add_page(p6)

    p7 = []
    y = 790
    y = draw_text_block(p7, 50, y, "6) BİLANÇO MODÜLÜ (VARLIK/BORÇ/ÖZKAYNAK)", size=16, bold=True)
    y = draw_text_block(p7, 50, y-10, "Bilanço kalemi ekleme:")
    y = draw_text_block(p7, 70, y-5, "1. Bilanço sekmesine geçin.\n2. + Yeni Kalem düğmesine basın.\n3. Tarih seçin (ay sonu önerilir).\n4. Tür seçin: Varlık veya Borç.\n5. Grup seçin (nakit, banka, kredi kartı vb.).\n6. Kalem adını yazın.\n7. Tutar ve para birimini girin.\n8. Kaydet'e basın.", width=82)
    y = draw_text_block(p7, 50, y-10, "Trend grafiği:", bold=True)
    draw_text_block(p7, 70, y-5, "Bilanço ekranındaki Aylık/Yıllık düğmesi ile trend görünümü değişir. Bu grafik, net finansal durumunuzun zaman içindeki yönünü izlemek için kullanılır.", width=82)
    pdf.add_page(p7)

    p8 = []
    y = 790
    y = draw_text_block(p8, 50, y, "7) DÖVİZ KURU YÖNETİMİ", size=16, bold=True)
    y = draw_text_block(p8, 50, y-10, "Üst menüdeki para simgesine basarak Döviz Kurları penceresini açın.")
    y = draw_text_block(p8, 70, y-5, "• Güncel Kurları Al: İnternetten anlık TRY/RUB değerini getirir.\n• Tümüne Uygula: Güncel değeri 12 aya otomatik yayar.\n• Aylık grid: Her ay için farklı kur girebilirsiniz.\n• Kaydet: Girilen değerleri kalıcı hale getirir.", width=82)
    y = draw_text_block(p8, 50, y-10, "ÖNEMLİ:", bold=True)
    draw_text_block(p8, 70, y-5, "Doğru rapor için önce kur ekranını doldurun. Sonrasında işlem girişine geçin.", width=82)
    pdf.add_page(p8)

    p9 = []
    y = 790
    y = draw_text_block(p9, 50, y, "8) RAPORLAR VE VERİ GÜVENLİĞİ", size=16, bold=True)
    y = draw_text_block(p9, 50, y-10, "Rapor alma:")
    y = draw_text_block(p9, 70, y-5, "• PDF simgesi: Yönetim özeti ve tabloları PDF olarak indirir.\n• Excel simgesi: Ayrıntılı çalışma sayfaları ile XLSX dosyası üretir.", width=82)
    y = draw_text_block(p9, 50, y-10, "Veri Yönetimi:")
    y = draw_text_block(p9, 70, y-5, "• JSON İndir: Mevcut tüm veriyi yedekler.\n• JSON Yükle: Eski yedeği geri yükler.\n• Verileri Temizle: Tüm kayıtları siler (geri dönüşsüz).", width=82)
    y = draw_text_block(p9, 50, y-10, "Güvenli kullanım önerisi:", bold=True)
    draw_text_block(p9, 70, y-5, "Her hafta en az bir kez JSON dışa aktarımı alın. Büyük güncellemeler öncesi mutlaka ayrıca yedek oluşturun.", width=82)
    pdf.add_page(p9)

    p10 = []
    y = 790
    y = draw_text_block(p10, 50, y, "9) SIK SORULAN SORULAR", size=16, bold=True)
    y = draw_text_block(p10, 50, y-10, "S: Gelir/gider toplamı ile net durum neden farklı olabilir?\nC: Farklı para birimlerinde kayıt varsa, kur tablosuna göre USD eşdeğer hesaplanır. Kur girişi eksikse sapma oluşabilir.", width=88)
    y = draw_text_block(p10, 50, y-10, "S: Yanlış işlemi nasıl düzeltebilirim?\nC: İşlemler sekmesine geçin, ilgili satırdaki düzenle düğmesini kullanın veya silip yeniden girin.", width=88)
    y = draw_text_block(p10, 50, y-10, "S: Bilanço neden boş görünüyor?\nC: Önce bir tarih ve tür seçerek en az bir bilanço kalemi kaydetmeniz gerekir.", width=88)
    y = draw_text_block(p10, 50, y-10, "S: Dil/Tema nasıl değişir?\nC: Üst çubuktaki Ay ve TR/EN düğmelerini kullanabilirsiniz.", width=88)
    draw_text_block(p10, 50, y-10, "Bu kılavuzla uygulamayı ilk günden itibaren güvenle kullanabilirsiniz.", width=88, bold=True)
    pdf.add_page(p10)

    os.makedirs('docs', exist_ok=True)
    out = 'docs/Butce_Takip_Kullanim_Kilavuzu.pdf'
    pdf.save(out)
    print(out)

if __name__ == '__main__':
    main()
