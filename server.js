const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer'); // Corrected this line
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// --- File Upload Setup ---
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ 
    storage: storage
});


// --- Database Connection ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 3, // <-- UPDATED from 5 to 3 to reduce connection usage
    queueLimit: 0
}).promise();

// --- Email Transporter Setup ---
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const app = express();

// --- Middleware ---

// --- UPDATED CORS CONFIGURATION ---
// This explicitly allows your frontend to make requests to this backend.
const corsOptions = {
  origin: 'https://apphoxtech.com',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// --- END OF UPDATE ---


app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// --- API Routes ---

// --- Helper function to format dates ---
function formatDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    // Adjust for timezone offset to prevent date from changing
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    const adjustedDate = new Date(date.getTime() + timezoneOffset);
    return adjustedDate.toISOString().split('T')[0];
}

// --- API Routes for Applicants ---
app.get('/api/applicants', async (req, res) => { try { const [rows] = await db.query('SELECT * FROM applicants ORDER BY id DESC'); res.json(rows); } catch (err) { console.error('Error fetching applicants:', err); res.status(500).json({ error: 'Failed to fetch applicants' }); } });
app.post('/api/applicants', upload.single('cvFile'), async (req, res) => { try { const { title, name, email, phone, address, totalExperience, currentCTC, expectedCTC, agreedCTC, joinDate, status, passport, aadhaar, pan, location, reportingManager, jobId } = req.body; const cvFilePath = req.file ? req.file.path : null; const sql = `INSERT INTO applicants (title, name, email, phone, address, totalExperience, currentCTC, expectedCTC, agreedCTC, joinDate, status, passport, aadhaar, pan, cvFilePath, location, feedback, jobId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`; const [result] = await db.query(sql, [title, name, email, phone, address, totalExperience, currentCTC, expectedCTC, agreedCTC, joinDate, status || 'Pending', passport, aadhaar, pan, cvFilePath, location, '[]', jobId]); res.status(201).json({ message: 'Applicant created successfully!', insertId: result.insertId }); } catch (err) { console.error('Error creating applicant:', err); res.status(500).json({ error: 'Failed to create applicant' }); } });
app.put('/api/applicants/:id/status', async (req, res) => { try { const { id } = req.params; const { status, reason } = req.body; await db.query('UPDATE applicants SET status = ?, rejectionReason = ? WHERE id = ?', [status, reason, id]); res.json({ message: 'Applicant status updated successfully' }); } catch (err) { console.error('Error updating applicant status:', err); res.status(500).json({ error: 'Failed to update status' }); } });
app.post('/api/applicants/:id/feedback', async (req, res) => { try { const { id } = req.params; const { feedback } = req.body; const [rows] = await db.query('SELECT feedback FROM applicants WHERE id = ?', [id]); if (rows.length === 0) { return res.status(404).json({ error: 'Applicant not found' }); } const existingFeedback = JSON.parse(rows[0].feedback || '[]'); existingFeedback.push(feedback); await db.query('UPDATE applicants SET feedback = ? WHERE id = ?', [JSON.stringify(existingFeedback), id]); res.json({ message: 'Feedback added successfully' }); } catch (err) { console.error('Error adding feedback:', err); res.status(500).json({ error: 'Failed to add feedback' }); } });

// --- API Routes for Users ---
app.get('/api/users', async (req, res) => { try { const [rows] = await db.query('SELECT id, name, email, role FROM users ORDER BY id DESC'); res.json(rows); } catch (err) { console.error('Error fetching users:', err); res.status(500).json({ error: 'Failed to fetch users' }); } });
app.post('/api/users/register', async (req, res) => { try { const { name, email, role } = req.body; const resetToken = crypto.randomBytes(32).toString('hex'); const passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex'); const passwordResetExpires = new Date(Date.now() + 3600000); const tempPassword = crypto.randomBytes(20).toString('hex'); const salt = await bcrypt.genSalt(10); const hashedPassword = await bcrypt.hash(tempPassword, salt); const sql = `INSERT INTO users (name, email, password, role, passwordResetToken, passwordResetExpires) VALUES (?, ?, ?, ?, ?, ?)`; await db.query(sql, [name, email, hashedPassword, role, passwordResetToken, passwordResetExpires]); 
const setPasswordUrl = `${process.env.FRONTEND_URL}/set-password?token=${resetToken}`; 
// --- UPDATED HTML for the email link ---
const mailOptions = { from: `"APPHOX MetaTrack360" <${process.env.EMAIL_USER}>`, to: email, subject: 'Welcome to APPHOX MetaTrack360 - Set Your Password', html: `<h1>Welcome, ${name}!</h1><p>An account has been created for you. Please click the link below to set your password.</p><a href="${setPasswordUrl}" style="color: blue; text-decoration: underline;">Set Your Password</a><p>This link will expire in one hour.</p>`, }; await transporter.sendMail(mailOptions); res.status(201).json({ message: 'User created successfully! A setup email has been sent.'}); } catch (err) { console.error('Error creating user:', err); if (err.code === 'ER_DUP_ENTRY') { return res.status(400).json({ error: 'Email address already exists.' }); } res.status(500).json({ error: 'Failed to create user' }); } });
app.post('/api/users/set-password', async (req, res) => { try { const { token, password } = req.body; const hashedToken = crypto.createHash('sha256').update(token).digest('hex'); const findUserSql = `SELECT * FROM users WHERE passwordResetToken = ? AND passwordResetExpires > NOW()`; const [users] = await db.query(findUserSql, [hashedToken]); if (users.length === 0) { return res.status(400).json({ error: 'Password reset token is invalid or has expired.' }); } const user = users[0]; const salt = await bcrypt.genSalt(10); const hashedPassword = await bcrypt.hash(password, salt); const updateUserSql = `UPDATE users SET password = ?, passwordResetToken = NULL, passwordResetExpires = NULL WHERE id = ?`; await db.query(updateUserSql, [hashedPassword, user.id]); res.json({ message: 'Password has been set successfully.' }); } catch (err) { console.error('Error setting password:', err); res.status(500).json({ error: 'Failed to set password.' }); } });

// --- API Routes for Employees ---
app.get('/api/employees', async (req, res) => { try { const [rows] = await db.query("SELECT * FROM employees WHERE status = 'Active' ORDER BY id DESC"); const formattedRows = rows.map(row => ({ ...row, joinDate: formatDate(row.joinDate), lastWorkingDate: formatDate(row.lastWorkingDate) })); res.json(formattedRows); } catch (err) { console.error('Error fetching employees:', err); res.status(500).json({ error: 'Failed to fetch employees' }); } });
app.get('/api/employees/archived', async (req, res) => { try { const [rows] = await db.query("SELECT * FROM employees WHERE status = 'Inactive' ORDER BY id DESC"); const formattedRows = rows.map(row => ({ ...row, joinDate: formatDate(row.joinDate), lastWorkingDate: formatDate(row.lastWorkingDate) })); res.json(formattedRows); } catch (err) { console.error('Error fetching archived employees:', err); res.status(500).json({ error: 'Failed to fetch archived employees' }); } });
app.post('/api/employees', async (req, res) => { try { const { name, employeeId, department, position, email, phone, joinDate, ctc, location, marketSegment, variablePay, probationPeriod, probationReduction, documents } = req.body; const sql = `INSERT INTO employees (name, employeeId, department, position, email, phone, joinDate, ctc, location, marketSegment, variablePay, probationPeriod, probationReduction, documents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`; const [result] = await db.query(sql, [name, employeeId, department, position, email, phone, joinDate, ctc, location, marketSegment, variablePay, probationPeriod, probationReduction, documents || '[]']); res.status(201).json({ message: 'Employee created successfully!', insertId: result.insertId }); } catch (err) { console.error('Error creating employee:', err); res.status(500).json({ error: 'Failed to create employee' }); } });
app.put('/api/employees/:id', upload.array('newDocuments', 10), async (req, res) => { try { const { id } = req.params; const { name, department, position, email, phone, joinDate, ctc, location, bankAccountNumber, pfNumber, uan, serviceLine, variablePay, probationPeriod, probationReduction, lastVariablePayDate, documents } = req.body; let currentDocuments = JSON.parse(documents || '[]'); if (req.files) { req.files.forEach(file => { currentDocuments.push({ name: file.originalname, path: file.path }); }); } const pPeriod = Array.isArray(probationPeriod) ? probationPeriod[0] : probationPeriod; const pReduction = Array.isArray(probationReduction) ? probationReduction[0] : probationReduction; const sql = `UPDATE employees SET name = ?, department = ?, position = ?, email = ?, phone = ?, joinDate = ?, ctc = ?, location = ?, bankAccountNumber = ?, pfNumber = ?, uan = ?, serviceLine = ?, variablePay = ?, probationPeriod = ?, probationReduction = ?, lastVariablePayDate = ?, documents = ? WHERE id = ?`; await db.query(sql, [ name, department, position, email, phone, joinDate, ctc, location, bankAccountNumber, pfNumber, uan, serviceLine, variablePay, pPeriod, pReduction, lastVariablePayDate, JSON.stringify(currentDocuments), id ]); res.json({ message: 'Employee updated successfully!' }); } catch (err) { console.error('Error updating employee:', err); res.status(500).json({ error: 'Failed to update employee' }); } });
app.put('/api/employees/:id/delete', async (req, res) => { try { const { id } = req.params; const { reason, lastWorkingDate } = req.body; await db.query("UPDATE employees SET status = 'Inactive', terminationReason = ?, lastWorkingDate = ? WHERE id = ?", [reason, lastWorkingDate, id]); res.json({ message: 'Employee archived successfully' }); } catch (err) { console.error('Error deleting employee:', err); res.status(500).json({ error: 'Failed to delete employee' }); } });

// --- API Routes for Offer Letters ---
app.get('/api/offer-letters', async (req, res) => { try { const [rows] = await db.query('SELECT * FROM offer_letters ORDER BY id DESC'); const formattedRows = rows.map(row => ({ ...row, joinDate: formatDate(row.joinDate), date: formatDate(row.date) })); res.json(formattedRows); } catch (err) { console.error('Error fetching offer letters:', err); res.status(500).json({ error: 'Failed to fetch offer letters' }); } });
app.post('/api/offer-letters', async (req, res) => { try { const { candidateName, position, salary, joinDate, probationPeriod, probationReduction, location, email, phone, applicantId, variablePay, currentCTC, date } = req.body; const sql = `INSERT INTO offer_letters (candidateName, position, salary, joinDate, probationPeriod, probationReduction, location, email, phone, applicantId, variablePay, currentCTC, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`; const [result] = await db.query(sql, [candidateName, position, salary, joinDate, probationPeriod, probationReduction, location, email, phone, applicantId, variablePay, currentCTC, date]); res.status(201).json({ message: 'Offer letter created successfully!', insertId: result.insertId }); } catch (err) { console.error('Error creating offer letter:', err); res.status(500).json({ error: 'Failed to create offer letter' }); } });
app.put('/api/offer-letters/:id/accept', async (req, res) => { try { const { id } = req.params; const sql = `UPDATE offer_letters SET status = 'Accepted' WHERE id = ?`; await db.query(sql, [id]); res.json({ message: 'Offer letter accepted successfully!' }); } catch (err) { console.error('Error accepting offer letter:', err); res.status(500).json({ error: 'Failed to accept offer letter' }); } });
app.put('/api/offer-letters/:id', async (req, res) => { try { const { id } = req.params; const letterData = req.body; const sql = `UPDATE offer_letters SET candidateName=?, position=?, salary=?, joinDate=?, probationPeriod=?, probationReduction=?, variablePay=? WHERE id=?`; await db.query(sql, [letterData.candidateName, letterData.position, letterData.salary, letterData.joinDate, letterData.probationPeriod, letterData.probationReduction, letterData.variablePay, id]); res.json({ message: 'Offer letter revised successfully!' }); } catch (err) { console.error('Error revising offer letter:', err); res.status(500).json({ error: 'Failed to revise offer letter' }); } });

// --- Server Start ---
app.get('/', (req, res) => { res.send('APPHOX MetaTrack360 API is running...'); });
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => { try { await db.query('SELECT 1'); console.log('Successfully connected to the database.'); } catch (err) { console.error('Error connecting to the database:', err.stack); } console.log(`Server is running on port ${PORT}`); });

