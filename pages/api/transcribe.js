export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).end();
    }

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Missing API key" });
    }

    try {
        // 🔹 Upload audio to AssemblyAI
        const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
            method: "POST",
            headers: {
                Authorization: apiKey,
                "Content-Type": "application/octet-stream",
            },
            body: req,
            duplex: "half",
        });

        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            return res.status(500).json({ error: err });
        }

        const { upload_url } = await uploadRes.json();

        // 🔹 Request transcription
        const transcriptRes = await fetch(
            "https://api.assemblyai.com/v2/transcript",
            {
                method: "POST",
                headers: {
                    Authorization: apiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    audio_url: upload_url,
                }),
            }
        );

        const transcriptData = await transcriptRes.json();
        const transcriptId = transcriptData.id;

        // 🔹 Poll until complete
        let completed = false;
        let finalText = "";

        while (!completed) {
            await new Promise((r) => setTimeout(r, 2000));

            const polling = await fetch(
                `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
                {
                    headers: {
                        Authorization: apiKey,
                    },
                }
            );

            const data = await polling.json();

            if (data.status === "completed") {
                completed = true;
                finalText = data.text;
            }

            if (data.status === "error") {
                throw new Error(data.error);
            }
        }

        return res.status(200).json({
            transcript: finalText,
        });
    } catch (err) {
        return res.status(500).json({
            error: err.message,
        });
    }
}