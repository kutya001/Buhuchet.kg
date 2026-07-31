import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/20 text-foreground font-semibold border-primary/30",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-[#D4A59A]/20 text-destructive border-[#D4A59A]/30 font-medium",
        outline: "border-border text-foreground",
        success:
          "border-transparent bg-[#A8B8A0]/20 text-[#4E6346] dark:text-[#A8B8A0] border-[#A8B8A0]/30 font-medium",
        warning:
          "border-transparent bg-[#E8D5B7]/30 text-[#7A6A5A] dark:text-[#E8D5B7] border-[#E8D5B7]/40 font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
