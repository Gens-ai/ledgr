import { getHouseholdId } from "@/lib/auth/session";
import { getCategories } from "@/queries/categories";
import { CategoryList } from "@/components/organisms/category-list";

export default async function CategoriesPage() {
  const householdId = await getHouseholdId();
  const groups = await getCategories(householdId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
      <CategoryList groups={groups} />
    </div>
  );
}
