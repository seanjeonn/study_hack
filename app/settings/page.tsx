import SettingsForm from "@/app/components/SettingsForm";

export default function SettingsPage() {
  return (
    <main className="px-6 py-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <SettingsForm />
      </div>
    </main>
  );
}
