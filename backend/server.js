require('dotenv').config();
const express = require('express');
const XLSX = require('xlsx');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const app = express();
app.use(express.json());

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.GITHUB_REPO.split('/');
const excelPath = process.env.GITHUB_EXCEL_PATH;
const branch = process.env.GITHUB_BRANCH || 'main';

// Helper: Get file SHA from repo
async function getCurrentSha() {
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: excelPath, ref: branch });
        return data.sha;
    } catch (e) {
        return undefined;
    }
}

// Helper: Download current Excel file from GitHub
async function getCurrentExcel() {
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: excelPath, ref: branch });
        if (data && data.content) {
            const buffer = Buffer.from(data.content, 'base64');
            fs.writeFileSync(excelPath, buffer);
        }
    } catch (e) {
        // File doesn't exist yet
        XLSX.writeFile(XLSX.utils.book_new(), excelPath);
    }
}

// Receive contact form submissions
app.post('/contact', async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ status: 'error', error: 'Missing fields' });

    await getCurrentExcel();
    let workbook = XLSX.readFile(excelPath);
    let worksheet = workbook.Sheets['Responses'];
    let data = worksheet ? XLSX.utils.sheet_to_json(worksheet) : [];
    data.push({ name, email, message, date: new Date().toISOString() });
    worksheet = XLSX.utils.json_to_sheet(data);
    workbook.Sheets['Responses'] = worksheet;
    XLSX.writeFile(workbook, excelPath);

    // Prepare file for GitHub
    const fileContent = fs.readFileSync(excelPath, 'base64');
    const sha = await getCurrentSha();
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: excelPath,
            message: 'Add new contact form entry',
            content: fileContent,
            branch,
            committer: { name: 'ContactBot', email: 'bot@cyriacpanackal.de' },
            author: { name: 'ContactBot', email: 'bot@cyriacpanackal.de' },
            sha: sha
        });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Contact backend listening on port', PORT));
