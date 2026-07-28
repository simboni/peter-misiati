import {
  BookIcon,
  ChipIcon,
  CoinsIcon,
  CompassIcon,
  FlagIcon,
  GlobeIcon,
  HandshakeIcon,
  HandsIcon,
  ScaleIcon,
  TrophyIcon,
} from "@/components/icons";

const icons = {
  book: BookIcon,
  trophy: TrophyIcon,
  chip: ChipIcon,
  coins: CoinsIcon,
  hands: HandsIcon,
  flag: FlagIcon,
  handshake: HandshakeIcon,
  compass: CompassIcon,
  scale: ScaleIcon,
  globe: GlobeIcon,
} as const;

export type IconName = keyof typeof icons;

export function ProgramIcon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
  className?: string;
}) {
  const Icon = icons[name];
  return <Icon className={className} />;
}
