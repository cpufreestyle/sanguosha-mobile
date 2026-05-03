from PIL import Image, ImageDraw, ImageFont
import os

out_dir = r"C:\Users\michael\.qclaw\workspace\sanguosha-mobile\icons"
os.makedirs(out_dir, exist_ok=True)

def make_icon(size):
    bg = (26, 10, 0, 255)
    gold = (200, 168, 75)
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)
    margin = size // 10
    draw.ellipse([margin, margin, size - margin, size - margin],
                 fill=(60, 30, 10, 255), outline=(200, 168, 75, 255), width=max(1, size // 20))
    inner = size // 5
    cx, cy = size // 2, size // 2
    draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner],
                 fill=(100, 50, 15, 255), outline=(200, 168, 75, 255), width=max(1, size // 30))
    sw = max(1, size // 20)
    half = int(size * 0.38)
    draw.line([cx - half, cy, cx + half, cy], fill=gold, width=sw)
    draw.line([cx, cy - half, cx, cy + half], fill=gold, width=sw)
    dot_r = max(1, size // 32)
    for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        draw.ellipse([cx + dx * half - dot_r, cy + dy * half - dot_r,
                      cx + dx * half + dot_r, cy + dy * half + dot_r], fill=gold)
    try:
        fontsize = size // 3
        font = ImageFont.truetype("C:\\Windows\\Fonts\\msyh.ttc", fontsize)
    except:
        font = ImageFont.load_default()
    text = "\u6740"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = cx - tw // 2
    ty = cy - th // 2 - size // 20
    draw.text((tx, ty), text, font=font, fill=gold)
    return img

for sz in [192, 512]:
    make_icon(sz).save(os.path.join(out_dir, f"icon-{sz}.png"))
    print(f"Saved icon-{sz}.png")
print("Done!")
