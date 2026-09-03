import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../base/button";
import { Typography } from "../base/typography";

const PageHeaderTitleRow = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
      className,
    )}
    {...props}
  />
);

const PageHeaderTitleSection = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 items-center", className)} {...props} />
);

const PageHeaderActions = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none", className)}
    {...props}
  />
);

export interface PageHeaderWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: "title-only" | "title-with-actions" | "title-with-toolbar";
  title: string;
  showBack?: boolean;
  onBackClick?: () => void;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  containerClassName?: string;
  headerClassName?: string;
}

const PageHeaderWrapper = React.forwardRef<HTMLDivElement, PageHeaderWrapperProps>(
  (
    {
      variant,
      title,
      showBack = false,
      onBackClick,
      actions,
      containerClassName,
      headerClassName,
      className,
      ...props
    },
    ref,
  ) => {
    const showActions = variant !== "title-with-toolbar" || !("filters" in props);
    return (
      <div ref={ref} className={cn("mb-6", containerClassName, className)} {...props}>
        <PageHeaderTitleRow className={headerClassName}>
          <PageHeaderTitleSection>
            {showBack && (
              <Button
                variant="ghost"
                size="sm-icon"
                allowNoTooltip
                className="mr-2"
                onClick={onBackClick}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Typography variant="h1" as="h1" className="text-foreground">
              {title}
            </Typography>
          </PageHeaderTitleSection>
          {showActions && actions && <PageHeaderActions>{actions}</PageHeaderActions>}
        </PageHeaderTitleRow>
      </div>
    );
  },
);
PageHeaderWrapper.displayName = "PageHeaderWrapper";

export { PageHeaderWrapper, PageHeaderActions, PageHeaderTitleRow, PageHeaderTitleSection };
