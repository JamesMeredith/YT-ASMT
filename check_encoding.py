import os
import sys

def main():
    # 从命令行参数获取文件路径
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
    else:
        # 如果没有提供参数，提示用户
        print("用法: python check_encoding.py <文件路径>")
        print("示例:")
        print("  python check_encoding.py server.js")
        print("  python check_encoding.py E:\\YT-ASMT\\server\\server.js")
        sys.exit(1)

    # 如果是相对路径，转换为绝对路径（基于当前工作目录）
    if not os.path.isabs(filepath):
        filepath = os.path.abspath(filepath)

    # 检查文件是否存在
    if not os.path.exists(filepath):
        print(f"错误: 文件不存在 - {filepath}")
        sys.exit(1)

    # Read raw bytes
    with open(filepath, 'rb') as f:
        raw = f.read()

    print(f"文件路径: {filepath}")
    print(f"文件大小: {len(raw)} bytes")
    print(f"前200字节(十六进制): {raw[:200].hex()}")

    # Try different decodings
    for enc in ['utf-8', 'utf-8-sig', 'gbk', 'gb2312', 'gb18030', 'latin-1', 'cp1252']:
        try:
            text = raw.decode(enc)
            qmarks = text.count('?')
            lines = text.split('\n')
            line_sample = lines[77].strip()[:100] if len(lines) > 77 else 'N/A'
            print(f"{enc:12s}: {len(text)} 字符, {qmarks} 个问号, 第78行示例: {line_sample}")
        except Exception as e:
            print(f"{enc:12s}: 错误 - {e}")

if __name__ == "__main__":
    main()