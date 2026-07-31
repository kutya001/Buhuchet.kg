import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-secondary text-foreground border-border",
        destructive:
          "border-[#D4A59A]/40 text-destructive [&>svg]:text-destructive bg-[#D4A59A]/15",
        success:
          "border-[#A8B8A0]/40 text-[#4E6346] dark:text-[#A8B8A0] [&>svg]:text-[#4E6346] dark:[&>svg]:text-[#A8B8A0] bg-[#A8B8A0]/15",
        warning:
          "border-[#E8D5B7]/40 text-[#7A6A5A] dark:text-[#E8D5B7] [&>svg]:text-[#7A6A5A] dark:[&>svg]:text-[#E8D5B7] bg-[#E8D5B7]/25",
        info:
          "border-primary/40 text-foreground [&>svg]:text-primary bg-primary/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
