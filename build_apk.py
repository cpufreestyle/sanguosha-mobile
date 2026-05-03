#!/usr/bin/env python3
"""
三国杀助手 APK 构建脚本
一键构建包含摄像头视觉识别功能的 Android APK
"""
import os
import sys
import shutil
import zipfile
import subprocess
import tempfile
from pathlib import Path

# Fix Windows console encoding
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ====== 配置 ======
APP_DIR = Path(__file__).parent
ANDROID_DIR = APP_DIR / "android"
ANDROID_APP_DIR = ANDROID_DIR / "src" / "com" / "sanguosha" / "assistant"
RES_DIR = ANDROID_DIR / "res"
BUILD_DIR = APP_DIR / "android_build"
ASSETS_DIR = ANDROID_DIR / "assets"

# Android SDK 路径
ANDROID_HOME = Path(os.environ.get("ANDROID_HOME", r"D:\Android"))
BUILD_TOOLS = ANDROID_HOME / "build-tools" / "34.0.0"
JDK_HOME = ANDROID_HOME / "jdk" / "openjdk-17"
PLATFORM = ANDROID_HOME / "platforms" / "android-34"

# 工具路径
AAPT2 = BUILD_TOOLS / "aapt2.exe"
AAPT2_COMPILE = BUILD_TOOLS / "aapt2"
D8 = BUILD_TOOLS / "d8.bat"
APKSIGNER = BUILD_TOOLS / "apksigner.bat"
ZIPALIGN = BUILD_TOOLS / "zipalign.exe"
JAVAC = JDK_HOME / "bin" / "javac.exe"
JAR = JDK_HOME / "bin" / "jar.exe"
JAVA = JDK_HOME / "bin" / "java.exe"

ANDROID_JAR = PLATFORM / "android.jar"
ANDROID_MANIFEST = ANDROID_DIR / "AndroidManifest.xml"

OUTPUT_DIR = APP_DIR / "dist"
OUTPUT_APK = OUTPUT_DIR / "三国杀助手.apk"

# 签名信息
KEYSTORE = APP_DIR / "sanguosha.keystore"
KEY_ALIAS = "sanguosha"
KEYSTORE_PASS = "android"
KEY_PASS = "android"
STORE_TYPE = "jks"


def log(msg):
    print(f"  {msg}")


def run(cmd, cwd=None, check=True):
    """运行命令"""
    print(f"\n>>> {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
    )
    if result.stdout:
        try:
            print(result.stdout.decode('utf-8', errors='replace')[:2000])
        except:
            print(result.stdout[:2000])
    if result.returncode != 0:
        try:
            err_text = result.stderr.decode('utf-8', errors='replace')[:2000]
        except:
            err_text = str(result.stderr[:2000])
        print(f"[STDERR] {err_text}")
        if check:
            sys.exit(f"命令执行失败: {' '.join(str(c) for c in cmd)}")
    return result


def build_apk():
    print("=" * 60)
    print("三国杀助手 APK 构建")
    print("=" * 60)

    # Step 1: 清理旧构建
    print("\n[1/7] 清理旧构建...")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    log("清理完成")

    # Step 2: 复制 Web 资源到 assets
    print("\n[2/7] 复制 Web 资源到 assets...")
    if ASSETS_DIR.exists():
        shutil.rmtree(ASSETS_DIR)
    ASSETS_DIR.mkdir(parents=True)

    web_files = ["index.html", "app.js", "data.js", "config.js", "manifest.json", "sw.js"]
    for f in web_files:
        src = APP_DIR / f
        if src.exists():
            shutil.copy2(src, ASSETS_DIR / f)
            log(f"  {f}")

    # Copy icons
    icons_src = APP_DIR / "icons"
    if icons_src.exists():
        shutil.copytree(icons_src, ASSETS_DIR / "icons")
        log("  icons/")

    log("Assets 准备完成")

    # Step 3: 编译资源
    print("\n[3/7] 编译 Android 资源...")
    RES_COMPILED = BUILD_DIR / "res_compiled"
    RES_COMPILED.mkdir(exist_ok=True)

    res_files = list(RES_DIR.rglob("*"))
    res_files = [f for f in res_files if f.is_file() and f.suffix in [".xml", ".png"]]
    log(f"找到 {len(res_files)} 个资源文件")

    # Group by directory for compile
    resource_dirs = list(RES_DIR.iterdir())
    for res_dir in resource_dirs:
        if not res_dir.is_dir():
            continue
        log(f"  编译目录: {res_dir.name}/")
        for res_file in res_dir.rglob("*"):
            if res_file.is_file():
                rel = res_file.relative_to(RES_DIR)
                output = RES_COMPILED / rel.parent / res_file.name
                output.parent.mkdir(parents=True, exist_ok=True)
                if res_file.suffix == ".xml":
                    cmd = [str(AAPT2), "compile", "--dir", str(RES_DIR), "-o", str(RES_COMPILED)]
                    break

    # Compile all resources at once
    cmd = [str(AAPT2), "compile", "--dir", str(RES_DIR), "-o", str(RES_COMPILED)]
    run(cmd)

    # Step 4: 编译 Java
    print("\n[4/7] 编译 Java 源码...")
    CLASSES_DIR = BUILD_DIR / "classes"
    CLASSES_DIR.mkdir(exist_ok=True)

    javac_files = list(ANDROID_APP_DIR.rglob("*.java"))
    log(f"找到 {len(javac_files)} 个 Java 文件")

    classpath = str(ANDROID_JAR)
    cmd = [
        str(JAVAC),
        "-source", "1.8", "-target", "1.8",
        "-cp", classpath,
        "-d", str(CLASSES_DIR),
        "-encoding", "UTF8",
    ] + [str(f) for f in javac_files]
    run(cmd)

    # Step 5: 生成 DEX 并打包 APK
    print("\n[5/7] 生成 DEX 并打包 APK...")

    # Create DEX file using dx (or d8)
    DEX_DIR = BUILD_DIR / "dex"
    DEX_DIR.mkdir(exist_ok=True)

    # First create a JAR of compiled classes
    jar_file = BUILD_DIR / "classes.jar"
    manifest_file = BUILD_DIR / "manifest.txt"

    # Create minimal manifest for jar
    with open(manifest_file, "w") as f:
        f.write("Manifest-Version: 1.0\n")

    cmd = [str(JAR), "cf", str(jar_file), "-C", str(CLASSES_DIR), ".", "-C", str(BUILD_DIR), "manifest.txt"]
    run(cmd)

    # Convert to DEX using d8.bat (d8.jar may not exist)
    DEX_FILE = DEX_DIR / "classes.dex"
    cmd = [str(D8),
        str(jar_file),
        "--output", str(DEX_DIR),
        "--min-api", "34"
    ]
    run(cmd)

    # Link resources and build base APK
    print("  链接资源...")
    LINKED_APK = BUILD_DIR / "app-base.apk"

    # Auto-version resources to avoid conflicts
    flat_files = list(Path(RES_COMPILED).rglob("*.flat"))
    log(f"找到 {len(flat_files)} 个 .flat 资源文件")

    cmd = [
        str(AAPT2), "link",
        "-o", str(LINKED_APK),
        "-I", str(ANDROID_JAR),
        "--manifest", str(ANDROID_MANIFEST),
        "--auto-add-overlay",
    ] + [str(f) for f in flat_files]
    try:
        run(cmd)
    except SystemExit:
        # Fallback: minimal flags
        cmd = [
            str(AAPT2), "link",
            "-o", str(LINKED_APK),
            "-I", str(ANDROID_JAR),
            "--manifest", str(ANDROID_MANIFEST),
        ] + [str(f) for f in flat_files]
        run(cmd)

    # Add assets and DEX using Python zipfile (aapt2 doesn't have 'add' subcommand)
    print("  添加 Assets 和 DEX...")
    FINAL_UNALIGNED = BUILD_DIR / "app-final-unaligned.apk"
    shutil.copy2(LINKED_APK, FINAL_UNALIGNED)

    with zipfile.ZipFile(str(FINAL_UNALIGNED), 'a', zipfile.ZIP_DEFLATED) as zf:
        # Add assets
        for root, dirs, files in os.walk(ASSETS_DIR):
            for file in files:
                full_path = os.path.join(root, file)
                arcname = "assets/" + os.path.relpath(full_path, ASSETS_DIR).replace("\\", "/")
                zf.write(full_path, arcname)
                log(f"  + {arcname}")
        # Add DEX
        for dex_file in DEX_DIR.glob("*.dex"):
            zf.write(str(dex_file), dex_file.name)
            log(f"  + {dex_file.name}")

    log("Assets 和 DEX 添加完成")

    # Step 6: 对齐 APK
    print("\n[6/7] 对齐 APK...")
    OUTPUT_DIR.mkdir(exist_ok=True)

    if FINAL_UNALIGNED.exists():
        if ZIPALIGN.exists():
            cmd = [str(ZIPALIGN), "-p", "4", str(FINAL_UNALIGNED), str(OUTPUT_DIR / "三国杀助手-未签名.apk")]
            run(cmd, check=False)
            unaligned = OUTPUT_DIR / "三国杀助手-未签名.apk"
        else:
            shutil.copy2(FINAL_UNALIGNED, OUTPUT_DIR / "三国杀助手-未签名.apk")
            unaligned = OUTPUT_DIR / "三国杀助手-未签名.apk"

    # Step 7: 签名 APK
    print("\n[7/7] 签名 APK...")

    # Check if keystore exists, if not create it
    if not KEYSTORE.exists():
        print("  创建签名密钥...")
        keytool = JDK_HOME / "bin" / "keytool.exe"
        if keytool.exists():
            keygen_cmd = [
                str(keytool), "-genkey",
                "-v", "-keystore", str(KEYSTORE),
                "-alias", KEY_ALIAS,
                "-keyalg", "RSA", "-keysize", "2048",
                "-validity", "10000",
                "-storepass", KEYSTORE_PASS,
                "-keypass", KEY_PASS,
                "-dname", "CN=sanguosha, OU=assistant, O=sanguosha, L=Beijing, ST=Beijing, C=CN"
            ]
            run(keygen_cmd, check=False)

    # Sign with apksigner.bat (--out must come before input APK)
    input_apk = str(unaligned) if (unaligned and unaligned.exists()) else str(FINAL_UNALIGNED)
    if KEYSTORE.exists():
        sign_cmd = [
            str(APKSIGNER), "sign",
            "--ks", str(KEYSTORE),
            "--ks-pass", f"pass:{KEYSTORE_PASS}",
            "--key-pass", f"pass:{KEY_PASS}",
            "--ks-key-alias", KEY_ALIAS,
            "--out", str(OUTPUT_APK),
            input_apk
        ]
        try:
            run(sign_cmd)
            log(f"APK 签名完成: {OUTPUT_APK}")
        except SystemExit:
            # Fallback: use jarsigner
            jarsigner = JDK_HOME / "bin" / "jarsigner.exe"
            if jarsigner.exists():
                sign_cmd = [
                    str(jarsigner),
                    "-sigalg", "SHA256withRSA",
                    "-digestalg", "SHA-256",
                    "-keystore", str(KEYSTORE),
                    "-storepass", KEYSTORE_PASS,
                    "-keypass", KEY_PASS,
                    input_apk,
                    KEY_ALIAS
                ]
                run(sign_cmd, check=False)
                shutil.copy2(input_apk, OUTPUT_APK)
            else:
                shutil.copy2(input_apk, OUTPUT_APK)
    else:
        # No signing, just copy as-is
        shutil.copy2(input_apk, OUTPUT_APK)

    # Verify
    apk_size = OUTPUT_APK.stat().st_size
    print(f"\n{'='*60}")
    print(f"APK build complete!")
    print(f"   Path: {OUTPUT_APK}")
    print(f"   Size: {apk_size / 1024:.1f} KB")
    print(f"{'='*60}")


if __name__ == "__main__":
    build_apk()
