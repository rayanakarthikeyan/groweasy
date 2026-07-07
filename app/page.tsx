const handleSubmit = async () => {
  if (!selectedFile) {
    return;
  }

  startTransition(() => {
    void (async () => {
      setPreviewError(null);

      try {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const response = await fetch("/api/import", {
          method: "POST",
          body: formData
        });

        const raw = await response.text();
        let payload: ImportApiResponse | { error: string };

        try {
          payload = JSON.parse(raw) as ImportApiResponse | { error: string };
        } catch {
          throw new Error(
            `Server returned non-JSON response (${response.status}): ${raw.slice(0, 200)}`
          );
        }

        if (!response.ok) {
          const message = "error" in payload ? payload.error : "Import failed.";
          throw new Error(message);
        }

        if ("error" in payload) {
          throw new Error(payload.error);
        }

        setResult(payload);
      } catch (error) {
        setResult(null);
        setPreviewError(
          error instanceof Error ? error.message : "Import failed. Please try again."
        );
      }
    })();
  });
};
