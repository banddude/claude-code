interface ClaudeLogoProps {
  size?: number;
  className?: string;
}

export default function ClaudeLogo({ size = 32, className = '' }: ClaudeLogoProps) {
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/aiva-icon.png"
        alt="AIVA"
        width={size}
        height={size}
        className="rounded-lg"
        style={{ filter: 'brightness(0) saturate(100%)' }}
      />
    </div>
  );
}
