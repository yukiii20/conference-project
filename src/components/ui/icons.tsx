/**
 * Thin Lucide wrappers behind the same names every page already imports, so
 * swapping the hand-drawn icon set for Lucide (see docs/ui-audit.md) didn't
 * require touching every call site - sizing stays controlled by the
 * Tailwind classes callers already pass via `className` (h-4 w-4, etc.),
 * same as the old hand-drawn set.
 */
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Info,
  Menu,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

export type IconProps = LucideProps

function wrap(LucideIconComponent: LucideIcon, defaultStrokeWidth = 2) {
  return function WrappedIcon(props: IconProps) {
    return <LucideIconComponent aria-hidden strokeWidth={defaultStrokeWidth} {...props} />
  }
}

export const CheckIcon = wrap(Check)
export const XIcon = wrap(X)
export const ChevronDownIcon = wrap(ChevronDown)
export const ChevronLeftIcon = wrap(ChevronLeft)
export const ChevronRightIcon = wrap(ChevronRight)
export const SearchIcon = wrap(Search)
export const UploadIcon = wrap(Upload)
export const DownloadIcon = wrap(Download)
export const TrashIcon = wrap(Trash2)
export const PencilIcon = wrap(Pencil)
export const PlusIcon = wrap(Plus)
export const AlertTriangleIcon = wrap(AlertTriangle)
export const AlertCircleIcon = wrap(AlertCircle)
export const InfoIcon = wrap(Info)
export const MenuIcon = wrap(Menu)
export const EyeIcon = wrap(Eye)
export const EyeOffIcon = wrap(EyeOff)
