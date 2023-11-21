const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors'); // Import the CORS package

const app = express();
const port = 3000;
const JWT_SECRET_KEY = 'secretsecret123';

const pool = new Pool({
    user: 'postgres',
    host: '34.126.77.158',
    database: 'quiz',
    password: 'mFjcp4DxQqP6',
    port: 5432,
});

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());

// Function to execute a query with a client from the pool
async function executeQuery(query, params) {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(query, params);
            return result;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Database query error', err);
        throw err;
    }
}

// JWT Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// User Login Endpoint
app.post('/login', async (req, res) => {
    const { nim, password } = req.body;
    const staticPasswordHash = '$2a$12$ynbYEiAWrfeAB0x6x3uInut1mx5sSMtBnzNhe/zzQVEDdLJ6vumNq';

    try {
        const userResult = await executeQuery('SELECT userid, nim, fullname FROM Users WHERE nim = $1', [nim]);

        if (userResult.rows.length === 0) {
            return res.status(401).send('User not found');
        }

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, staticPasswordHash);
        if (!validPassword) {
            return res.status(401).send('Invalid password');
        }

        const token = jwt.sign({ userID: user.userid, nim: user.nim }, JWT_SECRET_KEY, { expiresIn: '1h' });
        res.json({ token, fullname: user.fullname });
    } catch (err) {
        res.status(500).send('Error during login');
    }
});

// Submit Quiz Scores Endpoint (Protected)
app.post('/submit-score', authenticateToken, async (req, res) => {
    const { score } = req.body;
    const userID = req.user.userID; // Extract userID from JWT token

    try {
        await executeQuery('INSERT INTO UserQuizScores (UserID, Score, AttemptedAt) VALUES ($1, $2, NOW())', [userID, score]);
        res.status(201).send('Score submitted successfully');
    } catch (err) {
        res.status(500).send('Error during submitting score');
    }
});

// Submit Multiple Essay Answers Endpoint (Protected)
app.post('/submit-essay', authenticateToken, async (req, res) => {
    const { answers } = req.body;
    const userID = req.user.userID; // Extract userID from JWT token

    const query = `
        INSERT INTO QuizEssay (UserID, QuestionID, UserAnswer, SubmittedAt)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (UserID, QuestionID)
        DO UPDATE SET UserAnswer = EXCLUDED.UserAnswer, SubmittedAt = NOW()
    `;

    try {
        await Promise.all(answers.map(answer => {
            return executeQuery(query, [userID, answer.questionID, answer.userAnswer]);
        }));
        res.status(201).send('Essays submitted successfully');
    } catch (err) {
        console.error('Error during submitting essays:', err);
        res.status(500).send('Error during submitting essays');
    }
});

app.post('/submit-feedback', authenticateToken, async (req, res) => {
    const { userID, questionID, feedback } = req.body;

    const query = `
        UPDATE QuizEssay 
        SET feedback = $3
        WHERE UserID = $1 AND QuestionID = $2
    `;

    try {
        await executeQuery(query, [userID, questionID, feedback]);
        res.status(200).send('Feedback submitted successfully');
    } catch (err) {
        console.error('Error during submitting feedback:', err);
        res.status(500).send('Error during submitting feedback');
    }
});

// Endpoint to get feedback for a specific user's essay answers
app.get('/get-feedback', authenticateToken, async (req, res) => {
    const userID = req.user.userID; // Assuming userID is stored in JWT

    const query = `
        SELECT QuestionID, UserAnswer, Feedback 
        FROM QuizEssay 
        WHERE UserID = $1
    `;

    try {
        const result = await executeQuery(query, [userID]);
        if (result.rows.length === 0) {
            // Return default structure for 3 questions with empty feedback
            res.status(200).json([
                { QuestionID: 1, UserAnswer: "", Feedback: "" },
                { QuestionID: 2, UserAnswer: "", Feedback: "" },
                { QuestionID: 3, UserAnswer: "", Feedback: "" }
            ]);
        } else {
            res.status(200).json(result.rows);
        }
    } catch (err) {
        console.error('Error retrieving feedback:', err);
        res.status(500).send('Error retrieving feedback');
    }
});



app.listen(port, () => {
    console.log(`Quiz API listening at http://localhost:${port}`);
});


module.exports = app;
