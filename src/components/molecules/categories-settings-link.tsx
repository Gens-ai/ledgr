import Link from "next/link";
import { Tag } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function CategoriesSettingsLink() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>
          Add, rename, reorganize, or remove the categories and groups used across budgets,
          transactions, and reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" nativeButton={false} render={<Link href="/categories" />}>
          <Tag className="size-4" />
          Manage Categories
        </Button>
      </CardContent>
    </Card>
  );
}
